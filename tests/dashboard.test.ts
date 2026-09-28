import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(kind: "student" | "teacher", overrides: Record<string, unknown> = {}) {
  const body = kind === "student" ? uniqueStudent() : uniqueTeacher();
  const res = await request(app).post(`/api/auth/signup/${kind}`).send({ ...body, ...overrides });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, body: { ...body, ...overrides } };
}

describe("Dashboard, role-specific, real data only", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("student: returns real (empty) stats + mastery for a brand-new user", async () => {
    const { token } = await signup("student");
    const res = await request(app).get("/api/dashboard").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("student");
    // Brand-new: no fabricated numbers.
    expect(res.body.stats.streak).toBe(0);
    expect(res.body.stats.minutes).toBe(0);
    expect(res.body.insights.dayStreak).toBe(0);
    // Real mastery is present and honestly empty.
    expect(res.body.mastery).toBeTruthy();
    expect(res.body.mastery.hasActivity).toBe(false);
    expect(res.body.mastery.subjects).toEqual([]);
    expect(res.body.mastery.badges).toEqual([]);
  });

  it("student: mastery reflects real saved chapter progress", async () => {
    const { token } = await signup("student");
    // Save a genuinely-mastered chapter, then read the dashboard.
    await request(app)
      .put("/api/progress")
      .set(auth(token))
      .send({
        streak: 7,
        chapters: {
          "c7-sci-photosynthesis": { video: 100, practice: 100, test: 95, mastered: true },
        },
      });
    const res = await request(app).get("/api/dashboard").set(auth(token));
    expect(res.body.mastery.hasActivity).toBe(true);
    const science = res.body.mastery.subjects.find((s: { key: string }) => s.key === "science");
    expect(science).toBeTruthy();
    expect(science.pct).toBeGreaterThan(0);
    // Real earned badges (first chapter + 7-day streak).
    const keys = res.body.mastery.badges.map((b: { key: string }) => b.key);
    expect(keys).toContain("first-chapter");
    expect(keys).toContain("streak-7");
  });

  it("teacher: returns class aggregates keyed to their assignment", async () => {
    // A student in Class 7 / A, and a teacher who teaches Class 7 / A.
    await signup("student", { className: "Class 7", section: "A" });
    const { token } = await signup("teacher", { className: "Class 7", section: "A" });

    const res = await request(app).get("/api/dashboard").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("teacher");
    expect(typeof res.body.studentCount).toBe("number");
    expect(res.body.classAverage).toBeTruthy();
    expect(Array.isArray(res.body.roster)).toBe(true);
  });
});
