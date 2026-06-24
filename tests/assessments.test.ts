import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

async function tokenFor(kind: "student" | "teacher", over: Record<string, unknown> = {}) {
  const body = { ...(kind === "student" ? uniqueStudent() : uniqueTeacher()), ...over };
  const res = await request(app).post(`/api/auth/signup/${kind}`).send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Seed a few questions for Class 7 / Maths via the teacher API.
async function seedQuestions(teacher: string, n = 5) {
  for (let i = 0; i < n; i++) {
    const r = await request(app)
      .post("/api/assessments/questions")
      .set(auth(teacher))
      .send({
        className: "Class 7",
        subject: "Maths",
        text: `2 + ${i} = ?`,
        options: [`${2 + i}`, `${3 + i}`, `${4 + i}`, `${5 + i}`],
        correctIndex: 0,
        explanation: "Add them.",
        usage: "both",
      });
    expect(r.status).toBe(201);
  }
}

describe("Assessments — authoring", () => {
  it("teacher can create a question; student cannot", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");

    const ok = await request(app).post("/api/assessments/questions").set(auth(teacher)).send({
      className: "Class 7", subject: "Maths", text: "Q?", options: ["a", "b"], correctIndex: 1,
    });
    expect(ok.status).toBe(201);

    const denied = await request(app).post("/api/assessments/questions").set(auth(student)).send({
      className: "Class 7", subject: "Maths", text: "Q?", options: ["a", "b"], correctIndex: 1,
    });
    expect(denied.status).toBe(403);
  });

  it("rejects a question whose correctIndex is out of range", async () => {
    const teacher = await tokenFor("teacher");
    const r = await request(app).post("/api/assessments/questions").set(auth(teacher)).send({
      className: "Class 7", subject: "Maths", text: "Q?", options: ["a", "b"], correctIndex: 9,
    });
    expect(r.status).toBe(400);
  });
});

describe("Assessments — mock test", () => {
  let student: string;
  beforeEach(async () => {
    const teacher = await tokenFor("teacher");
    await seedQuestions(teacher, 5);
    student = await tokenFor("student"); // Class 7 / A by default
  });

  it("start serves questions WITHOUT the answer, submit grades server-side", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start")
      .set(auth(student))
      .send({ subject: "Maths", count: 5 });
    expect(start.status).toBe(201);
    expect(start.body.questions.length).toBeGreaterThan(0);
    // No correct answer leaked to the client.
    expect(start.body.questions[0].correctIndex).toBeUndefined();

    // Answer every question with option 0 (the seeded correct answer).
    const answers = start.body.questions.map(() => 0);
    const submit = await request(app)
      .post(`/api/assessments/mock/${start.body.attemptId}/submit`)
      .set(auth(student))
      .send({ answers });
    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(start.body.questions.length); // all correct
    expect(submit.body.review[0]).toHaveProperty("correctIndex"); // review reveals answers
  });

  it("cannot submit the same attempt twice", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start").set(auth(student)).send({ subject: "Maths", count: 3 });
    const answers = start.body.questions.map(() => 0);
    await request(app).post(`/api/assessments/mock/${start.body.attemptId}/submit`).set(auth(student)).send({ answers });
    const again = await request(app).post(`/api/assessments/mock/${start.body.attemptId}/submit`).set(auth(student)).send({ answers });
    expect(again.status).toBe(409);
  });
});

describe("Assessments — hourly challenge", () => {
  let student: string;
  beforeEach(async () => {
    const teacher = await tokenFor("teacher");
    await seedQuestions(teacher, 3);
    student = await tokenFor("student");
  });

  it("serves a question (no answer), scores an answer, enforces one per hour", async () => {
    const get = await request(app).get("/api/assessments/challenge").set(auth(student));
    expect(get.status).toBe(200);
    expect(get.body.alreadyPlayed).toBe(false);
    expect(get.body.question.correctIndex).toBeUndefined();

    const ans = await request(app)
      .post("/api/assessments/challenge/answer")
      .set(auth(student))
      .send({ questionId: get.body.question.id, chosenIndex: 0, msTaken: 1500 });
    expect(ans.status).toBe(200);
    expect(ans.body).toHaveProperty("points");

    // Second answer in the same hour is blocked.
    const again = await request(app)
      .post("/api/assessments/challenge/answer")
      .set(auth(student))
      .send({ questionId: get.body.question.id, chosenIndex: 0, msTaken: 1000 });
    expect(again.status).toBe(409);

    // Leaderboard includes the player.
    const lb = await request(app).get("/api/assessments/challenge/leaderboard").set(auth(student));
    expect(lb.status).toBe(200);
    expect(lb.body.you).not.toBeNull();
  });
});
