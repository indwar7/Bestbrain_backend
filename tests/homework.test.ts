import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

/*
  Homework crosses a privilege boundary in both directions: a student must not
  be able to author it, and must not be able to read work set for another
  class. Most of this file is those two, plus the rule that answers do not
  travel to a student before they have submitted.
*/
async function tokenFor(kind: "student" | "teacher", over: Record<string, unknown> = {}) {
  const body = { ...(kind === "student" ? uniqueStudent() : uniqueTeacher()), ...over };
  const res = await request(app).post(`/api/auth/signup/${kind}`).send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

async function makeQuestion(teacher: string, over: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post("/api/assessments/questions")
    .set(auth(teacher))
    .send({
      className: "Class 7",
      subject: "Science",
      chapterSlug: "light",
      text: `HW question ${Math.random()}`,
      options: ["a", "b", "c", "d"],
      correctIndex: 1,
      explanation: "Because b.",
      usage: "both",
      ...over,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function makeHomework(
  teacher: string,
  questionIds: string[],
  over: Record<string, unknown> = {}
) {
  const res = await request(app)
    .post("/api/homework")
    .set(auth(teacher))
    .send({
      className: "Class 7",
      subject: "Science",
      chapterSlug: "light",
      title: "Light homework",
      instructions: "Do all of it.",
      questionIds,
      dueAt: inDays(7),
      ...over,
    });
  return res;
}

describe("Homework — authoring", () => {
  it("a teacher can assign homework", async () => {
    const teacher = await tokenFor("teacher");
    const q1 = await makeQuestion(teacher);
    const q2 = await makeQuestion(teacher);

    const res = await makeHomework(teacher, [q1, q2]);
    expect(res.status).toBe(201);
    expect(res.body.homework.questionCount).toBe(2);
    expect(res.body.homework.isPublished).toBe(true);
  });

  it("a student cannot assign homework", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);

    const res = await request(app).post("/api/homework").set(auth(student)).send({
      className: "Class 7",
      subject: "Science",
      title: "Mine now",
      questionIds: [q1],
      dueAt: inDays(3),
    });
    expect(res.status).toBe(403);
  });

  it("refuses homework with no questions, and with a bad date", async () => {
    const teacher = await tokenFor("teacher");
    const q1 = await makeQuestion(teacher);

    expect((await makeHomework(teacher, [])).status).toBe(400);
    expect((await makeHomework(teacher, [q1], { dueAt: "not-a-date" })).status).toBe(400);
  });

  it("refuses questions that belong to another class", async () => {
    const teacher = await tokenFor("teacher");
    const other = await makeQuestion(teacher, { className: "Class 9" });
    const res = await makeHomework(teacher, [other]); // assignment says Class 7
    expect(res.status).toBe(400);
  });

  it("a teacher only lists their own assignments", async () => {
    const a = await tokenFor("teacher");
    const b = await tokenFor("teacher");
    const qa = await makeQuestion(a);
    await makeHomework(a, [qa], { title: "A's homework" });

    const mine = await request(app).get("/api/homework").set(auth(b));
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(0);
  });

  it("a teacher cannot edit or delete someone else's assignment", async () => {
    const a = await tokenFor("teacher");
    const b = await tokenFor("teacher");
    const qa = await makeQuestion(a);
    const created = await makeHomework(a, [qa]);
    const id = created.body.homework.id;

    const patched = await request(app)
      .patch(`/api/homework/${id}`)
      .set(auth(b))
      .send({ title: "hijacked" });
    expect(patched.status).toBe(403);

    const deleted = await request(app).delete(`/api/homework/${id}`).set(auth(b));
    expect(deleted.status).toBe(403);
  });

  it("publish and unpublish control whether students see it", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1], { isPublished: false });
    const id = created.body.homework.id;

    const hidden = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(hidden.body.total).toBe(0);

    await request(app).patch(`/api/homework/${id}`).set(auth(teacher)).send({ isPublished: true });

    const shown = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(shown.body.total).toBe(1);
  });
});

describe("Homework — the class boundary", () => {
  it("a student only sees homework for their own class", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student"); // Class 7
    const q7 = await makeQuestion(teacher);
    const q9 = await makeQuestion(teacher, { className: "Class 9" });

    await makeHomework(teacher, [q7], { title: "Class 7 work" });
    await makeHomework(teacher, [q9], { className: "Class 9", title: "Class 9 work" });

    const res = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.homework[0].title).toBe("Class 7 work");
  });

  it("a student cannot open another class's homework by id", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student"); // Class 7
    const q9 = await makeQuestion(teacher, { className: "Class 9" });
    const created = await makeHomework(teacher, [q9], {
      className: "Class 9",
      title: "Class 9 work",
    });
    const id = created.body.homework.id;

    const res = await request(app).get(`/api/homework/${id}`).set(auth(student));
    // 404, not 403 — an id-prober learns nothing about what exists
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("correctIndex");
  });

  it("a student cannot submit to another class's homework", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q9 = await makeQuestion(teacher, { className: "Class 9" });
    const created = await makeHomework(teacher, [q9], { className: "Class 9" });
    const id = created.body.homework.id;

    const res = await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q9, selectedIndex: 1 }] });
    expect(res.status).toBe(404);
  });
});

describe("Homework — doing the work", () => {
  it("serves the questions without the answers", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;

    const res = await request(app).get(`/api/homework/${id}`).set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(1);
    expect(res.body.questions[0]).not.toHaveProperty("correctIndex");
    expect(JSON.stringify(res.body)).not.toContain("correctIndex");
  });

  it("grades a submission and returns explanations", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher); // correctIndex 1
    const q2 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1, q2]);
    const id = created.body.homework.id;

    const res = await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({
        answers: [
          { questionId: q1, selectedIndex: 1 }, // right
          { questionId: q2, selectedIndex: 0 }, // wrong
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(1);
    expect(res.body.submission.total).toBe(2);
    expect(res.body.submission.status).toBe("submitted");
    expect(res.body.review.length).toBe(2);
    expect(res.body.review[0].isCorrect).toBe(true);
    expect(res.body.review[1].isCorrect).toBe(false);
    expect(res.body.review[1].explanation).toBe("Because b.");
  });

  it("counts an unanswered question as wrong rather than skipping it", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const q2 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1, q2]);
    const id = created.body.homework.id;

    const res = await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q1, selectedIndex: 1 }] }); // q2 omitted

    expect(res.body.submission.score).toBe(1);
    expect(res.body.submission.total).toBe(2); // graded against what was set
    expect(res.body.review[1].selectedIndex).toBe(-1);
    expect(res.body.review[1].isCorrect).toBe(false);
  });

  it("accepts late work and flags it", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1], { dueAt: inDays(-2) }); // already overdue
    const id = created.body.homework.id;

    const listed = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(listed.body.homework[0].overdue).toBe(true);

    const res = await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q1, selectedIndex: 1 }] });

    expect(res.status).toBe(201); // accepted, not refused
    expect(res.body.submission.status).toBe("late");
    expect(res.body.submission.score).toBe(1);
  });

  it("allows only one submission", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;
    const body = { answers: [{ questionId: q1, selectedIndex: 1 }] };

    expect((await request(app).post(`/api/homework/${id}/submit`).set(auth(student)).send(body)).status).toBe(201);
    const again = await request(app).post(`/api/homework/${id}/submit`).set(auth(student)).send(body);
    expect(again.status).toBe(409);
  });

  it("shows the student their status and score after submitting", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;

    await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q1, selectedIndex: 1 }] });

    const res = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(res.body.homework[0].status).toBe("submitted");
    expect(res.body.homework[0].score).toBe(1);
  });
});

describe("Homework — the teacher's roster", () => {
  it("lists who submitted and what they scored", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;

    await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q1, selectedIndex: 1 }] });

    const res = await request(app).get(`/api/homework/${id}/submissions`).set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.submissions[0].score).toBe(1);
    expect(res.body.submissions[0].studentName).toBeTruthy();
  });

  it("a student cannot read the roster", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;

    const res = await request(app).get(`/api/homework/${id}/submissions`).set(auth(student));
    expect(res.status).toBe(403);
  });

  it("deleting an assignment removes its submissions", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");
    const q1 = await makeQuestion(teacher);
    const created = await makeHomework(teacher, [q1]);
    const id = created.body.homework.id;
    await request(app)
      .post(`/api/homework/${id}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionId: q1, selectedIndex: 1 }] });

    expect((await request(app).delete(`/api/homework/${id}`).set(auth(teacher))).status).toBe(200);
    const listed = await request(app).get("/api/homework/assigned").set(auth(student));
    expect(listed.body.total).toBe(0);
  });
});
