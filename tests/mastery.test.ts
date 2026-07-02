import { describe, it, expect } from "vitest";
import { User } from "../src/models/User";
import { MockAttempt } from "../src/models/MockAttempt";
import { getMasteryInsights } from "../src/services/masteryInsights";
import "./setup";

async function makeStudent(progress?: Partial<{ chapters: Record<string, unknown>; streak: number }>) {
  return User.create({
    name: "Mastery Student",
    email: `m-${Date.now()}-${Math.round(performance.now())}@ex.com`,
    phone: "9999999999",
    password: "x",
    role: "student",
    rollNumber: `ROLL-${Date.now()}-${Math.round(performance.now())}`,
    className: "Class 7",
    section: "A",
    progress: {
      lang: "en",
      minutes: 0,
      streak: progress?.streak ?? 0,
      badges: [],
      chapters: progress?.chapters ?? {},
      pal: {},
    },
  });
}

describe("masteryInsights — real, derived, honest", () => {
  it("returns empty mastery + no badges for a brand-new student", async () => {
    const student = await makeStudent();
    const m = await getMasteryInsights(student);
    expect(m.hasActivity).toBe(false);
    expect(m.subjects).toEqual([]);
    expect(m.badges).toEqual([]);
  });

  it("derives per-subject mastery from real chapter progress", async () => {
    const student = await makeStudent({
      chapters: {
        "c7-sci-photosynthesis": { video: 100, practice: 80, test: 90, mastered: true },
        "c7-math-fractions": { video: 60, practice: 40, test: null, mastered: false },
      },
    });
    const m = await getMasteryInsights(student);
    expect(m.hasActivity).toBe(true);

    const science = m.subjects.find((s) => s.key === "science");
    const maths = m.subjects.find((s) => s.key === "maths");
    expect(science).toBeTruthy();
    expect(maths).toBeTruthy();
    // Science has a test → weighted higher; should beat the practice-only maths chapter.
    expect(science!.pct).toBeGreaterThan(maths!.pct);
    expect(science!.chapters).toBe(1);
  });

  it("counts event-completed chapters (completed:true, no pct fields) as mastery", async () => {
    // The event pipeline writes { completed: true } with NO video/practice/test.
    // Regression guard: these must score 100, not 0 (the old bug).
    const student = await makeStudent({
      chapters: { "c7-sci-heat": { completed: true } },
    });
    const m = await getMasteryInsights(student);
    expect(m.hasActivity).toBe(true);
    const science = m.subjects.find((s) => s.key === "science");
    expect(science).toBeTruthy();
    expect(science!.pct).toBe(100);
    // A completed chapter earns the first-chapter badge.
    expect(m.badges.find((b) => b.key === "first-chapter")).toBeTruthy();
  });

  it("awards a badge only when the milestone is genuinely met", async () => {
    const noBadge = await makeStudent({
      chapters: { "c7-sci-heat": { video: 40, practice: 10, test: null, mastered: false } },
      streak: 1,
    });
    const m1 = await getMasteryInsights(noBadge);
    expect(m1.badges.find((b) => b.key === "streak-3")).toBeFalsy();
    expect(m1.badges.find((b) => b.key === "first-chapter")).toBeFalsy();

    const withBadges = await makeStudent({
      chapters: { "c7-sci-photosynthesis": { video: 100, practice: 100, test: 95, mastered: true } },
      streak: 7,
    });
    const m2 = await getMasteryInsights(withBadges);
    expect(m2.badges.find((b) => b.key === "first-chapter")).toBeTruthy();
    expect(m2.badges.find((b) => b.key === "streak-3")).toBeTruthy();
    expect(m2.badges.find((b) => b.key === "streak-7")).toBeTruthy();
  });

  it("folds finished mock-test scores into subject mastery + a mock badge", async () => {
    const student = await makeStudent();
    await MockAttempt.create({
      userId: student._id,
      className: "Class 7",
      subject: "science",
      score: 9,
      total: 10,
      finished: true,
    });
    const m = await getMasteryInsights(student);
    expect(m.hasActivity).toBe(true);
    const science = m.subjects.find((s) => s.key === "science");
    expect(science).toBeTruthy();
    expect(science!.pct).toBe(90);
    expect(m.badges.find((b) => b.key === "first-mock")).toBeTruthy();
    expect(m.badges.find((b) => b.key === "mock-ace")).toBeTruthy();
  });
});
