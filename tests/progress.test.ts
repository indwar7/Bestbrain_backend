import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent } from "./setup";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function studentToken() {
  const res = await request(app).post("/api/auth/signup/student").send(uniqueStudent());
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

function evt(id: string, type: string, payload: Record<string, unknown>, occurredAt: string) {
  return { clientEventId: id, type, payload, occurredAt };
}

describe("Progress — sync (idempotent offline events)", () => {
  let token: string;
  beforeEach(async () => {
    token = await studentToken();
  });

  it("applies fresh events and accumulates minutes", async () => {
    const now = new Date().toISOString();
    const res = await request(app)
      .post("/api/progress/sync")
      .set(auth(token))
      .send({
        events: [
          evt("e1", "lesson_watched", { minutes: 20 }, now),
          evt("e2", "lesson_watched", { minutes: 15 }, now),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(2);
    expect(res.body.progress.minutes).toBe(35);
  });

  it("is idempotent — re-sending the same clientEventId is skipped", async () => {
    const now = new Date().toISOString();
    const first = await request(app)
      .post("/api/progress/sync")
      .set(auth(token))
      .send({ events: [evt("dup-1", "lesson_watched", { minutes: 10 }, now)] });
    expect(first.body.applied).toBe(1);
    expect(first.body.progress.minutes).toBe(10);

    // Same event id again → skipped, minutes unchanged.
    const again = await request(app)
      .post("/api/progress/sync")
      .set(auth(token))
      .send({ events: [evt("dup-1", "lesson_watched", { minutes: 10 }, now)] });
    expect(again.body.applied).toBe(0);
    expect(again.body.skipped).toBe(1);
    expect(again.body.progress.minutes).toBe(10);
  });

  it("marks a chapter completed", async () => {
    const now = new Date().toISOString();
    const res = await request(app)
      .post("/api/progress/sync")
      .set(auth(token))
      .send({ events: [evt("c1", "chapter_completed", { chapterId: "c7-sci-heat" }, now)] });
    expect(res.status).toBe(200);
    expect(res.body.progress.chapters["c7-sci-heat"].completed).toBe(true);
  });

  it("rejects an empty events array", async () => {
    const res = await request(app).post("/api/progress/sync").set(auth(token)).send({ events: [] });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/progress/sync")
      .send({ events: [evt("x", "streak_tick", {}, new Date().toISOString())] });
    expect(res.status).toBe(401);
  });
});

describe("Progress — snapshot get/save", () => {
  it("returns an empty snapshot for a brand-new student (no fake data)", async () => {
    const token = await studentToken();
    const res = await request(app).get("/api/progress").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.progress.minutes).toBe(0);
    expect(res.body.progress.streak).toBe(0);
    expect(res.body.progress.badges).toEqual([]);
    expect(res.body.progress.chapters).toEqual({});
  });

  it("merges a partial save onto existing progress", async () => {
    const token = await studentToken();
    const save = await request(app)
      .put("/api/progress")
      .set(auth(token))
      .send({ streak: 4, lang: "hi" });
    expect(save.status).toBe(200);

    const snap = await request(app).get("/api/progress").set(auth(token));
    expect(snap.body.progress.streak).toBe(4);
    expect(snap.body.progress.lang).toBe("hi");
    // Untouched fields stay at their defaults.
    expect(snap.body.progress.minutes).toBe(0);
  });
});
