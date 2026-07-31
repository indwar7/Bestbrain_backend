import { describe, it, expect, vi } from "vitest";

// Same LLM mock as pal.test.ts — we're testing the role plumbing and the REAL
// buildPalContext, not Gemini. `generatePalReply` is a spy so a test can make
// it fail on demand.
const generatePalReply = vi.fn(async () => "MOCK_REPLY");
vi.mock("../src/services/palService", () => ({
  MAX_MESSAGE_LENGTH: 4000,
  generatePalReply: (...args: unknown[]) => generatePalReply(...(args as [])),
  streamPalReply: vi.fn(async function* () {
    yield "MOCK";
  }),
}));

import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function studentToken() {
  const body = uniqueStudent();
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, body };
}

describe("PAL answers for every role", () => {
  it("student gets a reply", async () => {
    const { token } = await studentToken();
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain fractions" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });

  it("teacher gets a reply (class-snapshot context path)", async () => {
    // A teacher with a real roster — exercises the roster/insights branch.
    await studentToken();
    const res0 = await request(app).post("/api/auth/signup/teacher").send(uniqueTeacher());
    expect(res0.status).toBe(201);
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(res0.body.accessToken))
      .send({ message: "who is struggling this month?" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });

  it("teacher with no assigned classes still gets a reply", async () => {
    const t = uniqueTeacher();
    const res0 = await request(app).post("/api/auth/signup/teacher").send(t);
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(res0.body.accessToken))
      .send({ message: "draft a worksheet on Motion" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });

  it("parent gets a reply (child-progress context path)", async () => {
    const { body: child } = await studentToken();
    const res0 = await request(app).post("/api/auth/signup/parent").send({
      name: "Test Parent",
      email: `parent-${Date.now()}@ex.com`,
      phone: "7777777777",
      password: "Passw0rd!",
      childRollNumber: child.rollNumber,
      childName: child.name,
      childClass: child.className,
    });
    expect(res0.status).toBe(201);
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(res0.body.accessToken))
      .send({ message: "how is my child doing?" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });
});

describe("PAL failure handling", () => {
  it("a failed reply leaves no empty session behind", async () => {
    const { token } = await studentToken();
    generatePalReply.mockRejectedValueOnce(new Error("Vertex request timeout"));

    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain gravity" });
    expect(res.status).toBe(500);

    const list = await request(app).get("/api/pal/sessions").set(auth(token));
    expect(list.body.sessions).toHaveLength(0);
  });

  it("reports a credential failure as 'not configured', not a transient outage", async () => {
    const { token } = await studentToken();
    generatePalReply.mockRejectedValueOnce(
      new Error("invalid_grant: Invalid grant: account not found")
    );

    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain gravity" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("pal_not_configured");
  });
});

describe("PAL session recovery", () => {
  it("a sessionId that no longer exists blocks every later question", async () => {
    const { token } = await studentToken();
    const first = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "hi" });
    const sessionId = first.body.sessionId;

    await request(app).delete(`/api/pal/sessions/${sessionId}`).set(auth(token));

    const after = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "still there?", sessionId });
    expect(after.status).toBe(404); // client is stuck until it drops the id
  });
});
