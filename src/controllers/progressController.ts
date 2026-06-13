import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User, IProgress } from "../models/User";
import { ProgressEvent, ProgressEventType } from "../models/ProgressEvent";

interface IncomingEvent {
  clientEventId: string;
  type: ProgressEventType;
  payload?: Record<string, unknown>;
  occurredAt: string; // ISO timestamp from the client
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

  for (const e of fresh) {
    applyEvent(user.progress, e);
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
  }

  res.json({
    applied: fresh.length,
    skipped: events.length - fresh.length,
    progress: user.progress,
  });
}
