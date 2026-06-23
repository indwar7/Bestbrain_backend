import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent } from "./setup";
import "./setup";

async function signup() {
  const body = uniqueStudent();
  const res = await request(app).post("/api/auth/signup/student").send(body);
  expect(res.status).toBe(201);
  return body;
}

describe("OTP — send & verify (dev/console mode)", () => {
  it("sends an email OTP and returns a dev code in non-prod", async () => {
    const u = await signup();
    const res = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "email", email: u.email });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.devCode).toMatch(/^\d{6}$/); // 6-digit code surfaced in dev
  });

  it("verifies a correct code and marks email verified", async () => {
    const u = await signup();
    const send = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "email", email: u.email });
    const code = send.body.devCode;

    const verify = await request(app)
      .post("/api/auth/verify-otp")
      .send({ channel: "email", email: u.email, code });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
    expect(verify.body.emailVerified).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const u = await signup();
    await request(app).post("/api/auth/send-otp").send({ channel: "email", email: u.email });
    const verify = await request(app)
      .post("/api/auth/verify-otp")
      .send({ channel: "email", email: u.email, code: "000000" });
    expect(verify.status).toBe(400);
    expect(verify.body.verified).toBe(false);
  });

  it("works for phone too", async () => {
    const u = await signup();
    const send = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "phone", email: u.email });
    expect(send.body.devCode).toMatch(/^\d{6}$/);
    const verify = await request(app)
      .post("/api/auth/verify-otp")
      .send({ channel: "phone", email: u.email, code: send.body.devCode });
    expect(verify.body.phoneVerified).toBe(true);
  });

  it("does not leak account existence for unknown emails", async () => {
    const res = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "email", email: "nobody-xyz@nowhere.test" });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.devCode).toBeUndefined();
  });

  it("validates the channel", async () => {
    const u = await signup();
    const res = await request(app)
      .post("/api/auth/send-otp")
      .send({ channel: "carrier-pigeon", email: u.email });
    expect(res.status).toBe(400);
  });
});

describe("OTP — login gate is ON by default", () => {
  it("an unverified user is blocked when logging in", async () => {
    const u = await signup();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: u.password, role: "student" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("VERIFICATION_REQUIRED");
  });
});
