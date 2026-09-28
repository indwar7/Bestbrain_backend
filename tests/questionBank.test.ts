import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

// The bank is chapter practice: untimed, repeatable, and it must never hand a
// student the answer before they have committed to one. Most of what is worth
// testing here is that last part, plus the class boundary.
async function tokenFor(kind: "student" | "teacher", over: Record<string, unknown> = {}) {
  const body = { ...(kind === "student" ? uniqueStudent() : uniqueTeacher()), ...over };
  const res = await request(app).post(`/api/auth/signup/${kind}`).send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeQuestion(
  teacher: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  const res = await request(app)
    .post("/api/assessments/questions")
    .set(auth(teacher))
    .send({
      className: "Class 7",
      subject: "Science",
      chapterSlug: "light",
      text: `Bank question ${Math.random()}`,
      options: ["a", "b", "c", "d"],
      correctIndex: 2,
      explanation: "Because c.",
      usage: "bank",
      ...over,
    });
  expect(res.status).toBe(201);
  // createQuestion answers { id }, not a nested question object.
  return res.body.id as string;
}

describe("Question bank, serving", () => {
  it("returns questions for the student's own class and chapter", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student"); // Class 7 by default
    await makeQuestion(teacher, { chapterSlug: "light" });
    await makeQuestion(teacher, { chapterSlug: "light" });
    await makeQuestion(teacher, { chapterSlug: "heat" });

    const res = await request(app)
      .get("/api/assessments/bank?subject=Science&chapterSlug=light")
      .set(auth(student));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.questions.every((q: { chapterSlug: string }) => q.chapterSlug === "light")).toBe(true);
  });

  it("never includes the answer in a served question", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    await makeQuestion(teacher);

    const res = await request(app)
      .get("/api/assessments/bank?subject=Science")
      .set(auth(student));

    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty("correctIndex");
      expect(q).not.toHaveProperty("explanation");
    }
    // and nowhere in the payload at all, however it might be nested
    expect(JSON.stringify(res.body)).not.toContain("correctIndex");
  });

  it("does not serve another class's questions", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student"); // Class 7
    await makeQuestion(teacher, { className: "Class 9", chapterSlug: "light" });

    const res = await request(app)
      .get("/api/assessments/bank?subject=Science&chapterSlug=light")
      .set(auth(student));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("leaves mock-only questions out of the bank", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    await makeQuestion(teacher, { usage: "mock", chapterSlug: "sound" });

    const res = await request(app)
      .get("/api/assessments/bank?subject=Science&chapterSlug=sound")
      .set(auth(student));
    expect(res.body.total).toBe(0);
  });

  it("requires a subject", async () => {
    const student = await tokenFor("student");
    const res = await request(app).get("/api/assessments/bank").set(auth(student));
    expect(res.status).toBe(400);
  });

  it("is student-only", async () => {
    const teacher = await tokenFor("teacher");
    const res = await request(app)
      .get("/api/assessments/bank?subject=Science")
      .set(auth(teacher));
    expect(res.status).toBe(403);
  });
});

describe("Question bank, grading", () => {
  it("marks a right answer right and returns the explanation", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const id = await makeQuestion(teacher);

    const res = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 2 });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.correctIndex).toBe(2);
    expect(res.body.explanation).toBe("Because c.");
  });

  it("marks a wrong answer wrong but still explains it", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const id = await makeQuestion(teacher);

    const res = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 0 });

    expect(res.body.correct).toBe(false);
    expect(res.body.correctIndex).toBe(2);
    expect(res.body.explanation).toBe("Because c.");
  });

  it("pays coins on the first correct answer only", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const id = await makeQuestion(teacher);

    const first = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 2 });
    expect(first.body.coinsAwarded).toBeGreaterThan(0);
    const balanceAfterFirst = first.body.balance;

    // Drilling the same question again is fine, and worth nothing more.
    const second = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 2 });
    expect(second.body.correct).toBe(true);
    expect(second.body.coinsAwarded).toBe(0);
    expect(second.body.balance).toBe(balanceAfterFirst);
  });

  it("pays nothing for a wrong answer", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const id = await makeQuestion(teacher);

    const res = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 1 });
    expect(res.body.coinsAwarded).toBe(0);
    expect(res.body.balance).toBe(0);
  });

  it("refuses to grade a question from another class", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student"); // Class 7
    const id = await makeQuestion(teacher, { className: "Class 9" });

    const res = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: id, chosenIndex: 0 });

    // 403 rather than a graded answer: replying at all would leak correctIndex
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("correctIndex");
  });

  it("rejects a malformed questionId", async () => {
    const student = await tokenFor("student");
    const res = await request(app)
      .post("/api/assessments/bank/answer")
      .set(auth(student))
      .send({ questionId: "not-an-id", chosenIndex: 0 });
    expect(res.status).toBe(400);
  });
});

describe("Question bank, chapter counts", () => {
  it("counts bank questions per chapter for the student's class", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    await makeQuestion(teacher, { chapterSlug: "light" });
    await makeQuestion(teacher, { chapterSlug: "light" });
    await makeQuestion(teacher, { chapterSlug: "heat" });
    await makeQuestion(teacher, { className: "Class 9", chapterSlug: "light" });

    const res = await request(app)
      .get("/api/assessments/bank/chapters?subject=Science")
      .set(auth(student));

    expect(res.status).toBe(200);
    expect(res.body.chapters.light).toBe(2);
    expect(res.body.chapters.heat).toBe(1);
  });
});
