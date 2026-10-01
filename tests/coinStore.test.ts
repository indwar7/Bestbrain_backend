import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";
import { Question } from "../src/models/Question";
import { ChallengeAttempt } from "../src/models/ChallengeAttempt";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function student() {
  const res = await request(app).post("/api/auth/signup/student").send(uniqueStudent());
  return res.body.accessToken as string;
}
async function balance(t: string) {
  return (await request(app).get("/api/coins").set(auth(t))).body.balance as number;
}
const sign = (orderId: string, paymentId: string) =>
  crypto.createHmac("sha256", "rzp_test_secret").update(`${orderId}|${paymentId}`).digest("hex");

function stubRazorpay(orderId: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: orderId, amount: 9900, currency: "INR" }), { status: 200 })
  );
}
afterEach(() => vi.restoreAllMocks());

describe("Coin store", () => {
  it("lists the three packs", async () => {
    const t = await student();
    const res = await request(app).get("/api/coins/packs").set(auth(t));
    expect(res.body.enabled).toBe(true);
    expect(res.body.packs.map((p: { price: number; coins: number }) => [p.price, p.coins])).toEqual([
      [49, 100], [99, 250], [199, 600],
    ]);
  });

  it("opens an order, and a verified payment credits the coins exactly once", async () => {
    const t = await student();
    const start = await balance(t);
    stubRazorpay("order_TEST1");
    const order = await request(app).post("/api/coins/order").set(auth(t)).send({ packId: "pack_99" });
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ orderId: "order_TEST1", amount: 9900, keyId: "rzp_test_key", coins: 250 });

    const ok = await request(app).post("/api/coins/verify").set(auth(t))
      .send({ orderId: "order_TEST1", paymentId: "pay_1", signature: sign("order_TEST1", "pay_1") });
    expect(ok.status).toBe(200);
    expect(ok.body.balance).toBe(start + 250);

    const again = await request(app).post("/api/coins/verify").set(auth(t))
      .send({ orderId: "order_TEST1", paymentId: "pay_1", signature: sign("order_TEST1", "pay_1") });
    expect(again.body.balance).toBe(start + 250);
  });

  it("refuses a forged signature and someone else's order", async () => {
    const t = await student();
    stubRazorpay("order_TEST2");
    await request(app).post("/api/coins/order").set(auth(t)).send({ packId: "pack_49" });
    const forged = await request(app).post("/api/coins/verify").set(auth(t))
      .send({ orderId: "order_TEST2", paymentId: "pay_2", signature: "deadbeef" });
    expect(forged.status).toBe(400);
    const other = await student();
    const stolen = await request(app).post("/api/coins/verify").set(auth(other))
      .send({ orderId: "order_TEST2", paymentId: "pay_2", signature: sign("order_TEST2", "pay_2") });
    expect(stolen.status).toBe(404);
  });

  it("rejects unknown packs and non-students", async () => {
    const t = await student();
    expect((await request(app).post("/api/coins/order").set(auth(t)).send({ packId: "free" })).status).toBe(400);
    const teacher = (await request(app).post("/api/auth/signup/teacher").send(uniqueTeacher())).body.accessToken;
    expect((await request(app).post("/api/coins/order").set(auth(teacher)).send({ packId: "pack_49" })).status).toBe(403);
  });
});

describe("Arena coins", () => {
  async function arenaQuestion() {
    return Question.create({
      className: "Class 7", subject: "Science", text: "Arena q " + Math.random(),
      options: ["a", "b", "c", "d"], correctIndex: 2, difficulty: "easy", usage: "both", createdByRole: "admin",
    });
  }

  it("a daily gift for playing and coins for a right answer", async () => {
    const t = await student();
    const q = await arenaQuestion();
    const start = await balance(t);
    const res = await request(app).post("/api/assessments/challenge/answer").set(auth(t))
      .send({ questionId: String(q._id), chosenIndex: 2, msTaken: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.coins).toMatchObject({ daily: 5, correct: 5 });
    expect(await balance(t)).toBe(start + 10);
  });

  it("the top three of a finished hour get the bonus once", async () => {
    const t = await student();
    const me = (await request(app).get("/api/auth/me").set(auth(t))).body.user;
    const q = await arenaQuestion();
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    await ChallengeAttempt.create({
      userId: me.id, userName: "x", hourKey: past.toISOString().slice(0, 13),
      questionId: q._id, chosenIndex: 2, correct: true, msTaken: 1000, points: 99, createdAt: past,
    });
    const start = await balance(t);
    await request(app).get("/api/assessments/challenge/leaderboard").set(auth(t));
    await request(app).get("/api/assessments/challenge/leaderboard").set(auth(t));
    expect(await balance(t)).toBe(start + 20);
  });
});
