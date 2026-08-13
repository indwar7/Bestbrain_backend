import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent } from "./setup";
import "./setup";

// Password reset: request a code, then spend it. The interesting cases are the
// ones that must NOT work, so most of this file is about those.
const prevOtp = process.env.OTP_ENFORCED;
beforeAll(() => {
  process.env.OTP_ENFORCED = "false";
});
afterAll(() => {
  process.env.OTP_ENFORCED = prevOtp;
});

// Register a student and hand back their credentials.
async function signUp() {
  const body = uniqueStudent();
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return body;
}

// Ask for a reset code. Outside production with no mail provider configured the
// service returns the code as devCode, which is what makes this testable.
async function requestCode(email: string) {
  const res = await request(app).post("/api/auth/forgot-password").send({ email });
  expect(res.status).toBe(200);
  return res.body.devCode as string | undefined;
}

describe("Password reset — requesting a code", () => {
  it("answers identically for a registered and an unregistered email", async () => {
    const user = await signUp();

    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email });
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody-${Date.now()}@nowhere.test` });

    // Same status and same message — this endpoint must not become a way to
    // discover which addresses have accounts.
    expect(known.status).toBe(unknown.status);
    expect(known.body.message).toBe(unknown.body.message);
    expect(known.body.sent).toBe(true);
    expect(unknown.body.sent).toBe(true);
    // Only a real account gets a code issued.
    expect(unknown.body.devCode).toBeUndefined();
  });

  it("requires an email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });
});

describe("Password reset — spending a code", () => {
  it("resets the password, and the new one works while the old one stops", async () => {
    const user = await signUp();
    const code = await requestCode(user.email);
    expect(code).toBeTruthy();

    const next = "Rotated!456";
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code, password: next });
    expect(reset.status).toBe(200);
    expect(reset.body.reset).toBe(true);

    const old = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(old.status).toBe(401);

    const fresh = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: next });
    expect(fresh.status).toBe(200);
    expect(fresh.body.accessToken).toBeTruthy();
  });

  it("rejects a wrong code and leaves the password alone", async () => {
    const user = await signUp();
    await requestCode(user.email);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code: "000000", password: "Whatever!789" });
    expect(res.status).toBe(400);

    // The original password still signs in.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(200);
  });

  it("will not spend the same code twice", async () => {
    const user = await signUp();
    const code = await requestCode(user.email);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code, password: "FirstGo!123" });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code, password: "SecondGo!123" });
    expect(replay.status).toBe(400);

    // The replay must not have taken effect.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "SecondGo!123" });
    expect(login.status).toBe(401);
  });

  it("rejects a password shorter than the signup minimum", async () => {
    const user = await signUp();
    const code = await requestCode(user.email);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code, password: "abc" });
    expect(res.status).toBe(400);
  });

  it("reports an unknown email the same way as a bad code", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: `nobody-${Date.now()}@nowhere.test`, code: "123456", password: "Whatever!789" });
    // 400 with a generic message, not a 404 — otherwise this endpoint
    // enumerates accounts even though forgot-password does not.
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/not valid/i);
  });
});

describe("Password reset — codes are scoped to their purpose", () => {
  it("will not accept an email-verification code as a reset code", async () => {
    const user = await signUp();

    // A code issued by the verification flow, not the reset flow.
    const otp = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "email", email: user.email });
    expect(otp.status).toBe(200);
    const verifyCode = otp.body.devCode as string | undefined;
    expect(verifyCode).toBeTruthy();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: user.email, code: verifyCode, password: "Sneaky!999" });
    expect(res.status).toBe(400);

    // And the password really did not change.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "Sneaky!999" });
    expect(login.status).toBe(401);
  });
});
