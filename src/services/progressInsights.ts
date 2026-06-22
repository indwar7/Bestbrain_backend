import { ProgressEvent } from "../models/ProgressEvent";

// A day key like "2026-06-18" in UTC. We bucket activity by calendar day so a
// streak means "did something on consecutive days", not a raw counter.
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayKeyFrom(offsetDays: number, from: Date): string {
  const d = new Date(from.getTime() - offsetDays * 86400000);
  return dayKey(d);
}

export interface WeeklyPoint {
  day: string; // "2026-06-18"
  label: string; // "Mon"
  minutes: number;
  events: number;
}

export interface ProgressInsights {
  dayStreak: number; // consecutive active days ending today/yesterday
  activeToday: boolean;
  weekly: WeeklyPoint[]; // last 7 days, oldest → newest
  thisWeek: {
    minutes: number;
    lessons: number;
    exercises: number;
    chaptersCompleted: number;
    activeDays: number;
  };
  lastActiveAt: string | null; // ISO of the most recent event
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Build a derived view of a user's activity from their stored ProgressEvents.
// `now` is injectable so callers/tests can pass a fixed clock.
export async function getProgressInsights(
  userId: string,
  now: Date = new Date()
): Promise<ProgressInsights> {
  // Look back 60 days — enough to compute a meaningful streak without scanning
  // the whole event history.
  const since = new Date(now.getTime() - 60 * 86400000);
  const events = await ProgressEvent.find({
    userId,
    occurredAt: { $gte: since },
  })
    .select("type payload occurredAt")
    .sort({ occurredAt: 1 });

  // Bucket per calendar day.
  const perDay = new Map<
    string,
    { minutes: number; events: number; lessons: number; exercises: number; chapters: number }
  >();
  let lastActiveAt: Date | null = null;

  for (const e of events) {
    const key = dayKey(e.occurredAt);
    const bucket =
      perDay.get(key) ?? { minutes: 0, events: 0, lessons: 0, exercises: 0, chapters: 0 };
    bucket.events += 1;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === "lesson_watched") {
      bucket.minutes += Number(p.minutes ?? 0);
      bucket.lessons += 1;
    } else if (e.type === "exercise_submitted") {
      bucket.exercises += 1;
    } else if (e.type === "chapter_completed") {
      bucket.chapters += 1;
    }
    perDay.set(key, bucket);
    if (!lastActiveAt || e.occurredAt > lastActiveAt) lastActiveAt = e.occurredAt;
  }

  // --- day streak: count back from today; allow today to be empty as long as
  // yesterday was active (so an early-morning visit doesn't reset the streak). ---
  const todayKey = dayKey(now);
  const activeToday = perDay.has(todayKey);
  let dayStreak = 0;
  let cursor = activeToday ? 0 : 1; // if not active today, start checking yesterday
  // Cap the walk at the look-back window.
  while (cursor <= 60) {
    const key = dayKeyFrom(cursor, now);
    if (perDay.has(key)) {
      dayStreak += 1;
      cursor += 1;
    } else {
      break;
    }
  }

  // --- last 7 days weekly series (oldest → newest) ---
  const weekly: WeeklyPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKeyFrom(i, now);
    const b = perDay.get(key);
    const dow = new Date(now.getTime() - i * 86400000).getUTCDay();
    weekly.push({
      day: key,
      label: WEEKDAY[dow],
      minutes: b?.minutes ?? 0,
      events: b?.events ?? 0,
    });
  }

  // --- this-week (last 7 days) totals ---
  const thisWeek = weekly.reduce(
    (acc, pt) => {
      const b = perDay.get(pt.day);
      acc.minutes += b?.minutes ?? 0;
      acc.lessons += b?.lessons ?? 0;
      acc.exercises += b?.exercises ?? 0;
      acc.chaptersCompleted += b?.chapters ?? 0;
      if (b && b.events > 0) acc.activeDays += 1;
      return acc;
    },
    { minutes: 0, lessons: 0, exercises: 0, chaptersCompleted: 0, activeDays: 0 }
  );

  return {
    dayStreak,
    activeToday,
    weekly,
    thisWeek,
    lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
  };
}
