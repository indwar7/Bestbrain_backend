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

describe("Assessments, authoring", () => {
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

describe("Assessments, mock test", () => {
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

  it("reveals the solution one question at a time, and locks that answer in", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start").set(auth(student)).send({ subject: "Maths", count: 3 });
    const attemptId = start.body.attemptId;

    // Answer Q0 wrongly (option 1; the seeded correct answer is 0).
    const wrong = await request(app)
      .post(`/api/assessments/mock/${attemptId}/answer`)
      .set(auth(student)).send({ index: 0, chosenIndex: 1 });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctIndex).toBe(0);
    expect(wrong.body.explanation).toBe("Add them."); // solution comes back

    // Re-answering the same question can't change the locked-in choice.
    const retry = await request(app)
      .post(`/api/assessments/mock/${attemptId}/answer`)
      .set(auth(student)).send({ index: 0, chosenIndex: 0 });
    expect(retry.status).toBe(200);
    expect(retry.body.chosen).toBe(1); // still the original wrong answer
    expect(retry.body.correct).toBe(false);

    // Answer Q1 correctly, leave Q2 untouched.
    const right = await request(app)
      .post(`/api/assessments/mock/${attemptId}/answer`)
      .set(auth(student)).send({ index: 1, chosenIndex: 0 });
    expect(right.body.correct).toBe(true);

    // Final submit must trust the locked server-side answers over the body,
    // so claiming "all correct" at the end cannot inflate the score.
    const submit = await request(app)
      .post(`/api/assessments/mock/${attemptId}/submit`)
      .set(auth(student)).send({ answers: [0, 0, 0] });
    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(2); // Q0 wrong (locked), Q1 right, Q2 from body
    expect(submit.body.review[0].chosen).toBe(1);
  });

  it("rejects an out-of-range question index when revealing a solution", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start").set(auth(student)).send({ subject: "Maths", count: 3 });
    const bad = await request(app)
      .post(`/api/assessments/mock/${start.body.attemptId}/answer`)
      .set(auth(student)).send({ index: 99, chosenIndex: 0 });
    expect(bad.status).toBe(400);
  });

  it("cannot reveal a solution on an already-submitted attempt", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start").set(auth(student)).send({ subject: "Maths", count: 3 });
    await request(app).post(`/api/assessments/mock/${start.body.attemptId}/submit`)
      .set(auth(student)).send({ answers: [0, 0, 0] });
    const after = await request(app)
      .post(`/api/assessments/mock/${start.body.attemptId}/answer`)
      .set(auth(student)).send({ index: 0, chosenIndex: 0 });
    expect(after.status).toBe(409);
  });

  it("cannot submit the same attempt twice", async () => {
    const start = await request(app)
      .post("/api/assessments/mock/start").set(auth(student)).send({ subject: "Maths", count: 3 });
    const answers = start.body.questions.map(() => 0);
    await request(app).post(`/api/assessments/mock/${start.body.attemptId}/submit`).set(auth(student)).send({ answers });
    const again = await request(app).post(`/api/assessments/mock/${start.body.attemptId}/submit`).set(auth(student)).send({ answers });
    expect(again.status).toBe(409);
  });

  it("records a client-side attempt and returns it in history", async () => {
    const rec = await request(app)
      .post("/api/assessments/mock/record")
      .set(auth(student))
      .send({ subject: "Science", testName: "Class 7 Science - Cells", score: 7, total: 10, mastery: 82 });
    expect(rec.status).toBe(201);
    expect(rec.body.attempt).toMatchObject({ subject: "Science", testName: "Class 7 Science - Cells", score: 7, total: 10, mastery: 82 });

    const hist = await request(app).get("/api/assessments/mock/history").set(auth(student));
    expect(hist.status).toBe(200);
    const found = hist.body.attempts.find((a: { testName?: string }) => a.testName === "Class 7 Science - Cells");
    expect(found).toBeTruthy();
    expect(found).toMatchObject({ subject: "Science", score: 7, total: 10, mastery: 82 });
  });

  it("rejects a record with no subject or non-positive total", async () => {
    const bad = await request(app)
      .post("/api/assessments/mock/record")
      .set(auth(student))
      .send({ subject: "", total: 0 });
    expect(bad.status).toBe(400);
  });
});

describe("Assessments, hourly challenge", () => {
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
