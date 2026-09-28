import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// A teacher assigned to Class 7 / A / Science, and a matching student.
async function teacherFor(className = "Class 7", section = "A", subject = "Science") {
  const body = { ...uniqueTeacher(), className, section, subject };
  const res = await request(app).post("/api/auth/signup/teacher").send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

async function studentFor(
  className = "Class 7",
  section = "A",
  subjects = ["Science"]
) {
  const body = { ...uniqueStudent(), className, section, subjects };
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

async function createSession(teacherToken: string) {
  const res = await request(app)
    .post("/api/live")
    .set(auth(teacherToken))
    .send({ title: "Photosynthesis", className: "Class 7", section: "A", subject: "Science" });
  expect(res.status).toBe(201);
  const s = res.body.session;
  // The raw Mongoose doc serializes with _id; normalise to a stable id string.
  return { ...s, id: s.id ?? s._id };
}

describe("Live, create + list", () => {
  it("teacher creates a session with a join code; eligible student sees it", async () => {
    const teacher = await teacherFor();
    const session = await createSession(teacher);
    expect(session.joinCode).toBeTruthy();

    const student = await studentFor();
    const list = await request(app).get("/api/live").set(auth(student));
    expect(list.status).toBe(200);
    expect(list.body.sessions.some((s: { _id: string }) => s._id === session.id)).toBe(true);
  });
});

describe("Live, join by code", () => {
  it("eligible student joins with the correct code", async () => {
    const teacher = await teacherFor();
    const session = await createSession(teacher);
    const student = await studentFor();

    const res = await request(app)
      .post("/api/live/join-by-code")
      .set(auth(student))
      .send({ code: session.joinCode });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.session.id).toBe(session.id);
  });

  it("is case-insensitive and trims the code", async () => {
    const teacher = await teacherFor();
    const session = await createSession(teacher);
    const student = await studentFor();

    const res = await request(app)
      .post("/api/live/join-by-code")
      .set(auth(student))
      .send({ code: `  ${String(session.joinCode).toLowerCase()}  ` });
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(session.id);
  });

  it("rejects a wrong/unknown code with 404", async () => {
    const student = await studentFor();
    const res = await request(app)
      .post("/api/live/join-by-code")
      .set(auth(student))
      .send({ code: "NOPE-9Z-0000" });
    expect(res.status).toBe(404);
  });

  it("rejects an empty code with 400", async () => {
    const student = await studentFor();
    const res = await request(app)
      .post("/api/live/join-by-code")
      .set(auth(student))
      .send({ code: "  " });
    expect(res.status).toBe(400);
  });

  it("blocks an INELIGIBLE student even with a valid code (code is not a bypass)", async () => {
    const teacher = await teacherFor(); // Class 7 / A / Science
    const session = await createSession(teacher);
    // A student in a different class entirely.
    const outsider = await studentFor("Class 9", "B", ["Maths"]);

    const res = await request(app)
      .post("/api/live/join-by-code")
      .set(auth(outsider))
      .send({ code: session.joinCode });
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/live/join-by-code")
      .send({ code: "ANY-1A-1111" });
    expect(res.status).toBe(401);
  });
});
