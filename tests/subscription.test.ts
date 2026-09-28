import { describe, it, expect } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { app } from "../src/app";
import { Subscription } from "../src/models/Subscription";
import { uniqueStudent } from "./setup";
import "./setup";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const SECRET = "test_webhook_secret"; // matches tests/env.setup.ts

function sign(body: string) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

function postWebhook(payload: unknown, eventId: string, signature?: string) {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/api/subscription/webhook")
    .set("Content-Type", "application/json")
    .set("x-razorpay-event-id", eventId)
    .set("x-razorpay-signature", signature ?? sign(body))
    .send(body);
}

function activatedPayload(opts: {
  subId: string;
  email: string;
  amountPaise: number;
  currentStart: number;
  currentEnd: number;
  status?: string;
}) {
  return {
    event: "subscription.activated",
    created_at: opts.currentStart,
    payload: {
      subscription: {
        entity: {
          id: opts.subId,
          plan_id: "plan_test",
          customer_id: "cust_test",
          status: opts.status ?? "active",
          current_start: opts.currentStart,
          current_end: opts.currentEnd,
          notes: {},
        },
      },
      payment: {
        entity: { email: opts.email, contact: "+919999999999", amount: opts.amountPaise, currency: "INR" },
      },
    },
  };
}

async function signupStudent() {
  const body = uniqueStudent();
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, email: body.email as string, userId: res.body.user.id as string };
}

async function balanceOf(token: string) {
  const res = await request(app).get("/api/coins").set(auth(token));
  expect(res.status).toBe(200);
  return res.body.balance as number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("Subscription webhook, signature", () => {
  it("rejects a wrong signature", async () => {
    const { email } = await signupStudent();
    const res = await postWebhook(
      activatedPayload({ subId: "sub_1", email, amountPaise: 90000, currentStart: nowSec(), currentEnd: nowSec() + 2592000 }),
      "evt_bad_sig",
      "0".repeat(64)
    );
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed event", async () => {
    const { email } = await signupStudent();
    const res = await postWebhook(
      activatedPayload({ subId: "sub_2", email, amountPaise: 90000, currentStart: nowSec(), currentEnd: nowSec() + 2592000 }),
      "evt_ok"
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Subscription webhook, coin crediting", () => {
  it("credits coins equal to the rupee amount paid, for an already-linked account", async () => {
    const { token, email } = await signupStudent();
    const start = nowSec();
    const res = await postWebhook(
      activatedPayload({ subId: "sub_3", email, amountPaise: 90000, currentStart: start, currentEnd: start + 2592000 }),
      "evt_credit_1"
    );
    expect(res.status).toBe(200);
    expect(await balanceOf(token)).toBe(900);
  });

  it("a retried webhook (same event id) does not double-credit", async () => {
    const { token, email } = await signupStudent();
    const start = nowSec();
    const payload = activatedPayload({ subId: "sub_4", email, amountPaise: 90000, currentStart: start, currentEnd: start + 2592000 });
    await postWebhook(payload, "evt_retry");
    await postWebhook(payload, "evt_retry"); // Razorpay retries carry the SAME event id
    expect(await balanceOf(token)).toBe(900);
  });

  it("a new billing cycle (current_start advances) credits coins again", async () => {
    const { token, email } = await signupStudent();
    const cycle1Start = nowSec();
    await postWebhook(
      activatedPayload({ subId: "sub_5", email, amountPaise: 90000, currentStart: cycle1Start, currentEnd: cycle1Start + 2592000 }),
      "evt_cycle1"
    );
    expect(await balanceOf(token)).toBe(900);

    // next month's renewal, current_start has moved on
    const cycle2Start = cycle1Start + 2592000;
    await postWebhook(
      activatedPayload({
        subId: "sub_5",
        email,
        amountPaise: 90000,
        currentStart: cycle2Start,
        currentEnd: cycle2Start + 2592000,
      }),
      "evt_cycle2"
    );
    expect(await balanceOf(token)).toBe(1800);
  });

  it("does not credit coins for a subscription that is only 'created', not paid", async () => {
    const { token, email } = await signupStudent();
    const start = nowSec();
    await postWebhook(
      activatedPayload({
        subId: "sub_6",
        email,
        amountPaise: 90000,
        currentStart: start,
        currentEnd: start + 2592000,
        status: "created",
      }),
      "evt_created"
    );
    expect(await balanceOf(token)).toBe(0);
  });

  it("credits coins on claim when the payment arrived before the account existed", async () => {
    const email = `preexisting-${Date.now()}@ex.com`;
    const start = nowSec();
    // Payment webhook arrives first, no BestBrain account with this email yet.
    const res = await postWebhook(
      activatedPayload({ subId: "sub_7", email, amountPaise: 90000, currentStart: start, currentEnd: start + 2592000 }),
      "evt_preexisting"
    );
    expect(res.status).toBe(200);
    expect(res.body.handled).toBe(true);

    const stored = await Subscription.findOne({ razorpaySubscriptionId: "sub_7" });
    expect(stored?.userId).toBeNull();

    // Now they sign up with that same email, claimForUser runs on /auth/me
    // via getMySubscription, which is what /api/subscription/me calls.
    const signupRes = await request(app)
      .post("/api/auth/signup/student")
      .send({ ...uniqueStudent(), email });
    expect(signupRes.status).toBe(201);
    const token = signupRes.body.accessToken as string;

    const subRes = await request(app).get("/api/subscription/me").set(auth(token));
    expect(subRes.status).toBe(200);
    expect(subRes.body.active).toBe(true);
    expect(await balanceOf(token)).toBe(900);
  });
});
