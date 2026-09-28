import { describe, it, expect, vi } from "vitest";

// A spy so individual tests can make one call fail on demand, same pattern
// as pal-roles.test.ts.
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
import { awardCoins } from "../src/services/coinService";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signupStudent(coins = 0) {
  const res = await request(app).post("/api/auth/signup/student").send(uniqueStudent());
  expect(res.status).toBe(201);
  const userId = res.body.user.id as string;
  if (coins > 0) await awardCoins(userId, coins, "test_seed", `test_seed:${userId}`);
  return { token: res.body.accessToken as string, userId };
}

async function signupTeacher() {
  const res = await request(app).post("/api/auth/signup/teacher").send(uniqueTeacher());
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

async function balanceOf(token: string) {
  const res = await request(app).get("/api/coins").set(auth(token));
  expect(res.status).toBe(200);
  return res.body.balance as number;
}

describe("PAL, coin gate (students)", () => {
  it("charges 3 coins for a successful question", async () => {
    const { token } = await signupStudent(100);
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain photosynthesis" });
    expect(res.status).toBe(200);
    expect(await balanceOf(token)).toBe(97);
  });

  it("blocks with 402 when the student has fewer than 3 coins, without calling the model", async () => {
    const { token } = await signupStudent(2);
    generatePalReply.mockClear();
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain gravity" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("insufficient_coins");
    expect(res.body.balance).toBe(2);
    expect(generatePalReply).not.toHaveBeenCalled();
    // the failed attempt must not have charged anything
    expect(await balanceOf(token)).toBe(2);
  });

  it("refunds the 3 coins when the model call itself fails", async () => {
    const { token } = await signupStudent(100);
    generatePalReply.mockImplementationOnce(async () => {
      throw new Error("upstream exploded");
    });
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "explain fractions" });
    expect(res.status).toBe(500);
    expect(await balanceOf(token)).toBe(100); // charged, then refunded, net zero
  });

  it("a student with exactly 3 coins can ask exactly one question", async () => {
    const { token } = await signupStudent(3);
    const first = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "one" });
    expect(first.status).toBe(200);
    expect(await balanceOf(token)).toBe(0);

    const second = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "two" });
    expect(second.status).toBe(402);
  });

  it("does not charge a teacher for a PAL question", async () => {
    const token = await signupTeacher();
    const res = await request(app)
      .post("/api/pal/chat")
      .set(auth(token))
      .send({ message: "how is my class doing" });
    expect(res.status).toBe(200);
    // No coin balance field on a teacher account, confirms the gate never
    // touched it (an attempt to charge a role with no such flow would 402
    // or error, not 200).
  });

  it("streaming (/chat/stream) is gated the same way as the plain endpoint", async () => {
    const { token } = await signupStudent(2);
    const res = await request(app)
      .post("/api/pal/chat/stream")
      .set(auth(token))
      .send({ message: "explain doubt" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("insufficient_coins");
  });

  it("a successful stream charges 3 coins", async () => {
    const { token } = await signupStudent(100);
    const res = await request(app)
      .post("/api/pal/chat/stream")
      .set(auth(token))
      .send({ message: "explain doubt" });
    expect(res.status).toBe(200);
    expect(await balanceOf(token)).toBe(97);
  });
});
