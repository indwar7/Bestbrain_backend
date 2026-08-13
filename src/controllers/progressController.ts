import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User, IProgress } from "../models/User";
import { ProgressEvent, ProgressEventType } from "../models/ProgressEvent";
import { CoinLedger } from "../models/CoinLedger";

interface IncomingEvent {
  clientEventId: string;
  type: ProgressEventType;
  payload?: Record<string, unknown>;
  occurredAt: string; // ISO timestamp from the client
}

/**
 * What each kind of progress earns.
 *
 * Deliberately server-side: the client reports what happened, never what it
 * should be paid for it. And deliberately here rather than spread across the
 * cases below, so the whole earning scheme can be read — and changed — in one
 * place instead of being reconstructed from five.
 */
const COIN_RULES = {
  chapter_completed: 10,
  streak_tick: 5,
  badge_earned: 25,
  correct_exercise: 2,
  per_10_minutes: 1,
} as const;

// What one event earns. Returns 0 for anything that earns nothing, so the
// caller can simply skip writing a ledger line.
function coinsFor(event: IncomingEvent): number {
  const p = event.payload ?? {};
  switch (event.type) {
    case "chapter_completed":
      return typeof p.chapterId === "string" ? COIN_RULES.chapter_completed : 0;
    case "streak_tick":
      return COIN_RULES.streak_tick;
    case "badge_earned":
      return typeof p.badge === "string" ? COIN_RULES.badge_earned : 0;
    case "exercise_submitted":
      return p.correct ? COIN_RULES.correct_exercise : 0;
    case "lesson_watched":
      // Whole ten-minute blocks only, so a burst of one-minute pings cannot
      // out-earn actually sitting and watching.
      return Math.floor(Number(p.minutes ?? 0) / 10) * COIN_RULES.per_10_minutes;
    default:
      return 0;
  }
}

// Apply a single event's effect onto the in-memory progress object.
function applyEvent(progress: IProgress, event: IncomingEvent): void {
  const p = event.payload ?? {};
  switch (event.type) {
    case "lesson_watched":
      progress.minutes += Number(p.minutes ?? 0);
      break;
    case "exercise_submitted":
      // Track per-chapter exercise counts.
      if (typeof p.chapterId === "string") {
        const ch = (progress.chapters[p.chapterId] as Record<string, number>) ?? {};
        ch.exercises = (ch.exercises ?? 0) + 1;
        if (p.correct) ch.correct = (ch.correct ?? 0) + 1;
        progress.chapters[p.chapterId] = ch;
      }
      break;
    case "chapter_completed":
      if (typeof p.chapterId === "string") {
        const ch = (progress.chapters[p.chapterId] as Record<string, unknown>) ?? {};
        ch.completed = true;
        progress.chapters[p.chapterId] = ch;
      }
      break;
    case "streak_tick":
      progress.streak += 1;
      break;
    case "badge_earned":
      if (typeof p.badge === "string" && !progress.badges.includes(p.badge)) {
        progress.badges.push(p.badge);
      }
      break;
  }
}

// POST /api/progress/sync
// Body: { events: [{ clientEventId, type, payload, occurredAt }, ...] }
// Idempotent: events already stored (by clientEventId) are skipped.
export async function syncProgress(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const events: IncomingEvent[] = Array.isArray(req.body?.events)
    ? req.body.events
    : [];

  if (events.length === 0) {
    res.status(400).json({ error: "events array is required and cannot be empty" });
    return;
  }

  // Validate shape.
  for (const e of events) {
    if (!e.clientEventId || !e.type || !e.occurredAt) {
      res.status(400).json({
        error: "each event needs clientEventId, type and occurredAt",
      });
      return;
    }
  }

  const user = await User.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Find which events were already processed (idempotency).
  const ids = events.map((e) => e.clientEventId);
  const existing = await ProgressEvent.find({
    userId,
    clientEventId: { $in: ids },
  }).select("clientEventId");
  const seen = new Set(existing.map((e) => e.clientEventId));

  // Merge in chronological order so out-of-order batches apply correctly.
  const fresh = events
    .filter((e) => !seen.has(e.clientEventId))
    .sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );

  // Coins are earned off the same events, and only off events accepted as
  // fresh — so a replayed batch pays nothing, exactly as it changes nothing.
  if (typeof user.progress.coins !== "number") user.progress.coins = 0;
  const earnings: { refId: string; reason: string; delta: number; balanceAfter: number }[] = [];

  for (const e of fresh) {
    applyEvent(user.progress, e);
    const delta = coinsFor(e);
    if (delta > 0) {
      user.progress.coins += delta;
      earnings.push({
        // the event's own id, so the ledger line is as unrepeatable as the event
        refId: e.clientEventId,
        reason: e.type,
        delta,
        balanceAfter: user.progress.coins,
      });
    }
  }

  // Persist the event log (ordered, deduped) and the updated progress.
  if (fresh.length > 0) {
    user.markModified("progress");
    await user.save();
    await ProgressEvent.insertMany(
      fresh.map((e) => ({
        userId,
        clientEventId: e.clientEventId,
        type: e.type,
        payload: e.payload ?? {},
        occurredAt: new Date(e.occurredAt),
      })),
      { ordered: false }
    );
    if (earnings.length > 0) {
      // ordered:false so one duplicate refId cannot discard the rest. A
      // duplicate here means the line was already written, which is the
      // outcome we want anyway.
      await CoinLedger.insertMany(
        earnings.map((x) => ({ userId, ...x })),
        { ordered: false }
      ).catch(() => { /* balance is saved; a duplicate line is not a failure */ });
    }
  }

  res.json({
    applied: fresh.length,
    skipped: events.length - fresh.length,
    progress: user.progress,
  });
}
