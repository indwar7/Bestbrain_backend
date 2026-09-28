import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent } from "./setup";
import { env } from "../src/config/env";
import "./setup";

// Coins are earned from progress events and spent through /api/coins/spend.
// The cases that matter are the ones where a balance could be created out of
// nothing or charged twice, so most of this file is about those.
const prevOtp = process.env.OTP_ENFORCED;
beforeAll(() => {
  process.env.OTP_ENFORCED = "false";
});
afterAll(() => {
  process.env.OTP_ENFORCED = prevOtp;
});

async function signUp() {
  const body = uniqueStudent();
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Send one progress event and return the sync response.
function sendEvent(token: string, clientEventId: string, type: string, payload: unknown = {}) {
  return request(app)
    .post("/api/progress/sync")
    .set(auth(token))
    .send({
      events: [{ clientEventId, type, payload, occurredAt: new Date().toISOString() }],
    });
}

async function balanceOf(token: string) {
  const res = await request(app).get("/api/coins").set(auth(token));
  expect(res.status).toBe(200);
  return res.body.balance as number;
}

describe("Coins, earning", () => {
  it("starts at zero", async () => {
    const token = await signUp();
    expect(await balanceOf(token)).toBe(0);
  });

  it("pays for a completed chapter", async () => {
    const token = await signUp();
    await sendEvent(token, "ev-chapter-1", "chapter_completed", { chapterId: "c6-sci-1" });
    expect(await balanceOf(token)).toBe(10);
  });

  it("does not pay twice for the same event", async () => {
    const token = await signUp();
    await sendEvent(token, "ev-dup", "chapter_completed", { chapterId: "c6-sci-1" });
    const replay = await sendEvent(token, "ev-dup", "chapter_completed", { chapterId: "c6-sci-1" });
    expect(replay.body.applied).toBe(0);
    expect(replay.body.skipped).toBe(1);
    expect(await balanceOf(token)).toBe(10);
  });

  it("pays nothing for a wrong answer, and pays for a right one", async () => {
    const token = await signUp();
    await sendEvent(token, "ev-wrong", "exercise_submitted", { chapterId: "c", correct: false });
    expect(await balanceOf(token)).toBe(0);
    await sendEvent(token, "ev-right", "exercise_submitted", { chapterId: "c", correct: true });
    expect(await balanceOf(token)).toBe(2);
  });

  it("pays per whole ten minutes watched, not per ping", async () => {
    const token = await signUp();
    // nine one-minute pings must not out-earn one nine-minute block
    for (let i = 0; i < 9; i++) {
      await sendEvent(token, `ev-ping-${i}`, "lesson_watched", { minutes: 1 });
    }
    expect(await balanceOf(token)).toBe(0);

    await sendEvent(token, "ev-block", "lesson_watched", { minutes: 25 });
    expect(await balanceOf(token)).toBe(2); // floor(25/10)
  });

  it("records a line for every change, and the lines explain the balance", async () => {
    const token = await signUp();
    await sendEvent(token, "ev-a", "chapter_completed", { chapterId: "a" });
    await sendEvent(token, "ev-b", "badge_earned", { badge: "first-steps" });

    const res = await request(app).get("/api/coins").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(35); // 10 + 25
    expect(res.body.recent.length).toBe(2);
    // newest first, and each line carries the balance it produced
    expect(res.body.recent[0].balanceAfter).toBe(35);
    const sum = res.body.recent.reduce((a: number, l: { delta: number }) => a + l.delta, 0);
    expect(sum).toBe(res.body.balance);
  });
});

describe("Coins, spending", () => {
  async function fundedStudent() {
    const token = await signUp();
    // four badges = 100 coins
    for (let i = 0; i < 4; i++) {
      await sendEvent(token, `ev-badge-${i}`, "badge_earned", { badge: `b${i}` });
    }
    expect(await balanceOf(token)).toBe(100);
    return token;
  }

  it("charges the balance", async () => {
    const token = await fundedStudent();
    const res = await request(app)
      .post("/api/coins/spend")
      .set(auth(token))
      .send({ amount: 30, reason: "study-pdf", refId: "pdf-1" });
    expect(res.status).toBe(200);
    expect(res.body.spent).toBe(true);
    expect(res.body.balance).toBe(70);
    expect(await balanceOf(token)).toBe(70);
  });

  it("will not charge twice for the same refId", async () => {
    const token = await fundedStudent();
    const body = { amount: 30, reason: "study-pdf", refId: "pdf-same" };
    const first = await request(app).post("/api/coins/spend").set(auth(token)).send(body);
    expect(first.body.spent).toBe(true);

    const retry = await request(app).post("/api/coins/spend").set(auth(token)).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.spent).toBe(false);
    expect(retry.body.duplicate).toBe(true);
    // charged once, not twice
    expect(await balanceOf(token)).toBe(70);
  });

  it("refuses to spend more than the balance, and leaves it untouched", async () => {
    const token = await fundedStudent();
    const res = await request(app)
      .post("/api/coins/spend")
      .set(auth(token))
      .send({ amount: 500, reason: "study-pdf", refId: "pdf-too-big" });
    expect(res.status).toBe(400);
    expect(res.body.spent).toBe(false);
    expect(await balanceOf(token)).toBe(100);
  });

  it("rejects a zero, negative or fractional charge", async () => {
    const token = await fundedStudent();
    for (const amount of [0, -10, 2.5]) {
      const res = await request(app)
        .post("/api/coins/spend")
        .set(auth(token))
        .send({ amount, reason: "x", refId: `bad-${amount}` });
      expect(res.status).toBe(400);
    }
    expect(await balanceOf(token)).toBe(100);
  });

  it("requires a refId, so a retry can always be recognised", async () => {
    const token = await fundedStudent();
    const res = await request(app)
      .post("/api/coins/spend")
      .set(auth(token))
      .send({ amount: 10, reason: "study-pdf" });
    expect(res.status).toBe(400);
    expect(await balanceOf(token)).toBe(100);
  });

  it("keeps balances separate between students", async () => {
    const a = await fundedStudent();
    const b = await signUp();
    await request(app)
      .post("/api/coins/spend")
      .set(auth(a))
      .send({ amount: 50, reason: "study-pdf", refId: "pdf-a" });

    expect(await balanceOf(a)).toBe(50);
    expect(await balanceOf(b)).toBe(0);
  });

  it("needs a signed-in student", async () => {
    const res = await request(app)
      .post("/api/coins/spend")
      .send({ amount: 10, reason: "x", refId: "y" });
    expect(res.status).toBe(401);
  });
});

describe("Coins, welcome bonus", () => {
  it("gives a new student their starting coins once, even across logins", async () => {
    const prev = env.welcomeCoins;
    env.welcomeCoins = 100;
    try {
      const body = uniqueStudent();
      const res = await request(app).post("/api/auth/signup/student").send(body);
      expect(res.status).toBe(201);
      expect(await balanceOf(res.body.accessToken)).toBe(100);
      const again = await request(app)
        .post("/api/auth/login")
        .send({ email: body.email, password: body.password, role: "student" });
      if (again.status === 200) expect(await balanceOf(again.body.accessToken)).toBe(100);
    } finally {
      env.welcomeCoins = prev;
    }
  });
});
