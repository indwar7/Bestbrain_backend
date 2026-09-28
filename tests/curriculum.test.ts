import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

async function tokenFor(kind: "student" | "teacher") {
  const path = `/api/auth/signup/${kind}`;
  const body = kind === "student" ? uniqueStudent() : uniqueTeacher();
  const res = await request(app).post(path).send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("Curriculum, authoring (teacher)", () => {
  let teacher: string;
  beforeEach(async () => {
    teacher = await tokenFor("teacher");
  });

  it("creates a subject and chapters, lists them in order", async () => {
    const subj = await request(app)
      .post("/api/curriculum/subjects")
      .set(auth(teacher))
      .send({ name: "Mathematics", className: "Class 7", board: "CBSE" });
    expect(subj.status).toBe(201);
    const subjectId = subj.body.subject._id;

    // Add two chapters out of order; list should sort by `order`.
    await request(app).post("/api/curriculum/chapters").set(auth(teacher)).send({
      subjectId, title: "Fractions", order: 2,
    });
    await request(app).post("/api/curriculum/chapters").set(auth(teacher)).send({
      subjectId, title: "Integers", order: 1,
    });

    const list = await request(app)
      .get(`/api/curriculum/subjects/${subjectId}/chapters`)
      .set(auth(teacher));
    expect(list.status).toBe(200);
    expect(list.body.chapters.map((c: { title: string }) => c.title)).toEqual([
      "Integers",
      "Fractions",
    ]);
    // slug auto-derived from title
    expect(list.body.chapters[0].slug).toBe("integers");
  });

  it("rejects duplicate subject for the same class", async () => {
    await request(app).post("/api/curriculum/subjects").set(auth(teacher))
      .send({ name: "Science", className: "Class 7" });
    const dup = await request(app).post("/api/curriculum/subjects").set(auth(teacher))
      .send({ name: "Science", className: "Class 7" });
    expect(dup.status).toBe(409);
  });

  it("updates and deletes a chapter", async () => {
    const subj = await request(app).post("/api/curriculum/subjects").set(auth(teacher))
      .send({ name: "History", className: "Class 7" });
    const chap = await request(app).post("/api/curriculum/chapters").set(auth(teacher))
      .send({ subjectId: subj.body.subject._id, title: "Ancient India" });
    const id = chap.body.chapter._id;

    const upd = await request(app).patch(`/api/curriculum/chapters/${id}`).set(auth(teacher))
      .send({ estimatedMinutes: 55, isPublished: false });
    expect(upd.status).toBe(200);
    expect(upd.body.chapter.estimatedMinutes).toBe(55);
    expect(upd.body.chapter.isPublished).toBe(false);

    const del = await request(app).delete(`/api/curriculum/chapters/${id}`).set(auth(teacher));
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/curriculum/chapters/${id}`).set(auth(teacher));
    expect(after.status).toBe(404);
  });
});

describe("Curriculum, permissions", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/curriculum/subjects");
    expect(res.status).toBe(401);
  });

  it("students can read but not write", async () => {
    const teacher = await tokenFor("teacher");
    const student = await tokenFor("student");

    // teacher creates content
    const subj = await request(app).post("/api/curriculum/subjects").set(auth(teacher))
      .send({ name: "Geography", className: "Class 7" });
    expect(subj.status).toBe(201);

    // student can read
    const read = await request(app).get("/api/curriculum/subjects").set(auth(student));
    expect(read.status).toBe(200);
    expect(read.body.subjects.length).toBeGreaterThan(0);

    // student cannot create
    const write = await request(app).post("/api/curriculum/subjects").set(auth(student))
      .send({ name: "Sneaky", className: "Class 7" });
    expect(write.status).toBe(403);
  });
});
