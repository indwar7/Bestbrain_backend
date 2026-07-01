import { IUser } from "../models/User";
import { MockAttempt } from "../models/MockAttempt";

// ---------------------------------------------------------------------------
// Real, derived mastery + badges for a student.
//
// Everything here is computed from data the student actually generated:
//   - progress.chapters : per-chapter { video, practice, test, mastered } %s,
//                          keyed like "c7-sci-photosynthesis" / "c7-math-fractions"
//   - MockAttempt        : finished mock tests, scored per subject
// If a student has done nothing, these return empty — never invented numbers.
// ---------------------------------------------------------------------------

export interface SubjectMastery {
  key: string; // canonical subject key: "maths" | "science" | "sst" | "english" | "hindi"
  name: string; // display name
  pct: number; // 0..100, derived
  chapters: number; // chapters touched in this subject
}

export interface EarnedBadge {
  key: string; // stable id
  label: string; // human label
  earnedFrom: string; // short reason (real)
}

export interface MasteryInsights {
  subjects: SubjectMastery[]; // only subjects with real activity
  badges: EarnedBadge[]; // only genuinely earned badges
  hasActivity: boolean; // false → frontend shows an honest empty state
}

// Map the subject slug embedded in a chapter key / mock subject to a canonical
// key + display name. Unknown slugs fall through to a title-cased label.
const SUBJECT_ALIASES: Record<string, { key: string; name: string }> = {
  math: { key: "maths", name: "Maths" },
  maths: { key: "maths", name: "Maths" },
  mathematics: { key: "maths", name: "Maths" },
  sci: { key: "science", name: "Science" },
  science: { key: "science", name: "Science" },
  sst: { key: "sst", name: "SST" },
  social: { key: "sst", name: "SST" },
  eng: { key: "english", name: "English" },
  english: { key: "english", name: "English" },
  hindi: { key: "hindi", name: "Hindi" },
  hin: { key: "hindi", name: "Hindi" },
};

function canonicalSubject(slug: string): { key: string; name: string } {
  const s = slug.toLowerCase().trim();
  if (SUBJECT_ALIASES[s]) return SUBJECT_ALIASES[s];
  const name = s ? s.charAt(0).toUpperCase() + s.slice(1) : "Other";
  return { key: s || "other", name };
}

// Extract the subject slug from a chapter key like "c7-sci-photosynthesis".
// Convention: "<class>-<subject>-<chapter>". Returns "" if it doesn't match.
function subjectFromChapterKey(key: string): string {
  const parts = key.split("-");
  return parts.length >= 3 ? parts[1] : "";
}

// A single chapter's mastery: weight the three real signals. Test carries the
// most weight (it proves understanding), then practice, then just watching.
function chapterScore(ch: Record<string, unknown>): number {
  const video = clampPct(ch.video);
  const practice = clampPct(ch.practice);
  const test = ch.test == null ? null : clampPct(ch.test);
  if (test != null) return Math.round(0.5 * test + 0.3 * practice + 0.2 * video);
  return Math.round(0.6 * practice + 0.4 * video);
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------------------
// Main entry: derive subjects + badges for one student.
// ---------------------------------------------------------------------------
// A minimal finished-mock shape (subject + score/total) — all the mastery
// computation needs. Lets the batch path pass pre-fetched mocks.
export interface MockLike {
  subject: string;
  score: number;
  total: number;
}

export async function getMasteryInsights(user: IUser): Promise<MasteryInsights> {
  // ---- fetch this user's finished mocks (single-user path) ----
  const mocks = await MockAttempt.find({ userId: user._id, finished: true }).select(
    "subject score total"
  );
  return computeMastery(user, mocks);
}

// Batch version: fetch finished mocks for MANY students in ONE query, then
// compute each student's mastery in memory (avoids the per-student MockAttempt
// query the teacher/parent dashboards used to fire). Returns a Map by userId.
export async function getMasteryInsightsBatch(
  users: IUser[]
): Promise<Map<string, MasteryInsights>> {
  const result = new Map<string, MasteryInsights>();
  if (users.length === 0) return result;

  const ids = users.map((u) => u._id);
  const mocks = await MockAttempt.find({ userId: { $in: ids }, finished: true }).select(
    "userId subject score total"
  );
  const mocksByUser = new Map<string, MockLike[]>();
  for (const m of mocks) {
    const key = String(m.userId);
    const arr = mocksByUser.get(key) ?? [];
    arr.push({ subject: m.subject, score: m.score, total: m.total });
    mocksByUser.set(key, arr);
  }
  for (const u of users) {
    result.set(String(u._id), computeMastery(u, mocksByUser.get(String(u._id)) ?? []));
  }
  return result;
}

// Pure computation shared by single + batch paths.
function computeMastery(user: IUser, mocks: MockLike[]): MasteryInsights {
  const chapters = (user.progress?.chapters ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  // ---- per-subject mastery from chapters ----
  const bySubject = new Map<
    string,
    { name: string; sum: number; count: number; mastered: number }
  >();

  for (const [key, ch] of Object.entries(chapters)) {
    if (!ch || typeof ch !== "object") continue;
    const slug = subjectFromChapterKey(key);
    const { key: subjKey, name } = canonicalSubject(slug);
    const entry = bySubject.get(subjKey) ?? { name, sum: 0, count: 0, mastered: 0 };
    entry.sum += chapterScore(ch);
    entry.count += 1;
    if (ch.mastered === true) entry.mastered += 1;
    bySubject.set(subjKey, entry);
  }

  // ---- fold in finished mock-test performance per subject ----
  const mockBySubject = new Map<string, { pctSum: number; n: number }>();
  for (const m of mocks) {
    if (!m.total) continue;
    const { key: subjKey } = canonicalSubject(m.subject);
    const pct = Math.round((m.score / m.total) * 100);
    const agg = mockBySubject.get(subjKey) ?? { pctSum: 0, n: 0 };
    agg.pctSum += pct;
    agg.n += 1;
    mockBySubject.set(subjKey, agg);
  }

  const subjects: SubjectMastery[] = [];
  const allKeys = new Set<string>([...bySubject.keys(), ...mockBySubject.keys()]);
  for (const subjKey of allKeys) {
    const chap = bySubject.get(subjKey);
    const mock = mockBySubject.get(subjKey);
    const chapPct = chap && chap.count ? chap.sum / chap.count : null;
    const mockPct = mock && mock.n ? mock.pctSum / mock.n : null;

    // Blend chapters + mocks when both exist; otherwise use whichever we have.
    let pct: number;
    if (chapPct != null && mockPct != null) pct = Math.round(0.6 * chapPct + 0.4 * mockPct);
    else pct = Math.round((chapPct ?? mockPct) as number);

    subjects.push({
      key: subjKey,
      name: chap?.name ?? canonicalSubject(subjKey).name,
      pct: Math.max(0, Math.min(100, pct)),
      chapters: chap?.count ?? 0,
    });
  }
  subjects.sort((a, b) => b.pct - a.pct);

  // ---- badges: only genuinely earned ----
  const badges: EarnedBadge[] = [];
  const totalMastered = [...bySubject.values()].reduce((s, e) => s + e.mastered, 0);
  const streak = Number(user.progress?.streak ?? 0);
  const finishedMocks = mocks.length;
  const bestMock = mocks.reduce((best, m) => {
    if (!m.total) return best;
    return Math.max(best, Math.round((m.score / m.total) * 100));
  }, 0);

  if (totalMastered >= 1)
    badges.push({ key: "first-chapter", label: "First Chapter Mastered", earnedFrom: "1 chapter mastered" });
  if (totalMastered >= 5)
    badges.push({ key: "five-chapters", label: "Five Chapters Mastered", earnedFrom: `${totalMastered} chapters mastered` });
  if (streak >= 3)
    badges.push({ key: "streak-3", label: "3-Day Streak", earnedFrom: `${streak}-day streak` });
  if (streak >= 7)
    badges.push({ key: "streak-7", label: "7-Day Streak", earnedFrom: `${streak}-day streak` });
  if (finishedMocks >= 1)
    badges.push({ key: "first-mock", label: "First Mock Test", earnedFrom: "completed a mock test" });
  if (bestMock >= 90)
    badges.push({ key: "mock-ace", label: "Mock Ace (90%+)", earnedFrom: `top mock score ${bestMock}%` });

  const hasActivity = subjects.length > 0 || badges.length > 0;

  return { subjects, badges, hasActivity };
}
