import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM layer so tests run offline and free. The controller imports
// generatePalReply / streamPalReply / MAX_MESSAGE_LENGTH from palService.
vi.mock("../src/services/palService", () => ({
  MAX_MESSAGE_LENGTH: 4000,
  generatePalReply: vi.fn(async () => "MOCK_REPLY"),
  streamPalReply: vi.fn(async function* () {
    yield "MOCK ";
    yield "STREAM";
  }),
}));

import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent } from "./setup";
import { awardCoins } from "../src/services/coinService";
import "./setup"; // register lifecycle hooks

// PAL now costs coins per question for students (see palController's
// chargePalQuestion), a fresh signup has none, so every test here needs a
// balance seeded first or it would 402 before ever reaching the mocked LLM.
async function signupStudent() {
  const res = await request(app).post("/api/auth/signup/student").send(uniqueStudent());
  expect(res.status).toBe(201);
  await awardCoins(res.body.user.id, 100, "test_seed", `test_seed:${res.body.user.id}`);
  return res.body.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("PAL chat", () => {
  let token: string;
  beforeEach(async () => {
    token = await signupStudent();
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/pal/chat").send({ message: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects an empty message", async () => {
    const res = await request(app).post("/api/pal/chat").set(auth(token)).send({ message: "" });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long message", async () => {
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "x".repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  it("returns a reply and a sessionId", async () => {
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "Hello PAL" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("MOCK_REPLY");
    expect(res.body.sessionId).toBeTruthy();
  });

  it("persists turns and continues the same session", async () => {
    const first = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "first" });
    const sid = first.body.sessionId;

    await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "second", sessionId: sid });

    const full = await request(app).get(`/api/pal/sessions/${sid}`).set(auth(token));
    expect(full.status).toBe(200);
    // 2 turns x 2 messages (user+assistant) = 4
    expect(full.body.session.messages).toHaveLength(4);
  });

  it("404s for a sessionId that isn't yours", async () => {
    const mine = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "hi" });
    const sid = mine.body.sessionId;

    const otherToken = await signupStudent();
    const res = await request(app).get(`/api/pal/sessions/${sid}`).set(auth(otherToken));
    expect(res.status).toBe(404);
  });
});

describe("PAL sessions CRUD", () => {
  let token: string;
  beforeEach(async () => {
    token = await signupStudent();
  });

  it("lists sessions newest-first with a preview title", async () => {
    await request(app).post("/api/pal/chat").set(auth(token)).send({ message: "about fractions" });
    const res = await request(app).get("/api/pal/sessions").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].title).toMatch(/fractions/);
    expect(res.body.sessions[0].messageCount).toBe(2);
  });

  it("renames a session", async () => {
    const chat = await request(app).post("/api/pal/chat").set(auth(token)).send({ message: "hi" });
    const sid = chat.body.sessionId;
    const res = await request(app)
      .patch(`/api/pal/sessions/${sid}`)
      .set(auth(token))
      .send({ title: "My Maths Chat" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("My Maths Chat");
  });

  it("deletes a session", async () => {
    const chat = await request(app).post("/api/pal/chat").set(auth(token)).send({ message: "hi" });
    const sid = chat.body.sessionId;
    const del = await request(app).delete(`/api/pal/sessions/${sid}`).set(auth(token));
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/pal/sessions/${sid}`).set(auth(token));
    expect(after.status).toBe(404);
  });
});

describe("PAL streaming (SSE)", () => {
  it("streams chunks then a done event", async () => {
    const token = await signupStudent();
    const res = await request(app)
      .post("/api/pal/chat/stream")
      .set(auth(token))
      .send({ message: "stream please" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("event: chunk");
    expect(res.text).toContain("MOCK ");
    expect(res.text).toContain("event: done");
  });
});

describe("AI tutor / live doubt session (SSE)", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/pal/tutor/stream").send({ message: "hi" });
    expect(res.status).toBe(401);
  });

  it("streams a voice reply and saves a mode:'voice' session", async () => {
    const token = await signupStudent();
    const res = await request(app)
      .post("/api/pal/tutor/stream")
      .set(auth(token))
      .send({ message: "what is photosynthesis" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("event: chunk");
    expect(res.text).toContain("event: done");

    // The session it created must be tagged as a voice session and carry both
    // turns, so the transcript survives the call.
    const list = await request(app).get("/api/pal/sessions").set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].mode).toBe("voice");
    expect(list.body.sessions[0].messageCount).toBe(2);
  });

  it("continues an existing voice session when given its sessionId", async () => {
    const token = await signupStudent();
    const first = await request(app)
      .post("/api/pal/tutor/stream")
      .set(auth(token))
      .send({ message: "first doubt" });
    const sid = JSON.parse(
      first.text.split("event: done\ndata: ")[1].split("\n")[0]
    ).sessionId as string;
    expect(sid).toBeTruthy();

    await request(app)
      .post("/api/pal/tutor/stream")
      .set(auth(token))
      .send({ message: "follow-up doubt", sessionId: sid });

    const full = await request(app).get(`/api/pal/sessions/${sid}`).set(auth(token));
    expect(full.status).toBe(200);
    expect(full.body.session.messages).toHaveLength(4);
    expect(full.body.session.mode).toBe("voice");
  });
});
