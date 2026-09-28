import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { uniqueStudent, uniqueTeacher } from "./setup";
import "./setup";

// These suites exercise the production auth flow: email + password, OTP gate OFF.
const prevOtp = process.env.OTP_ENFORCED;
beforeAll(() => {
  process.env.OTP_ENFORCED = "false";
});
afterAll(() => {
  process.env.OTP_ENFORCED = prevOtp;
});

describe("Auth, signup", () => {
  it("signs up a student and returns an access token + public user", async () => {
    const body = uniqueStudent();
    const res = await request(app).post("/api/auth/signup/student").send(body);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe("student");
    expect(res.body.user.email).toBe(body.email.toLowerCase());
    // Password must never be returned.
    expect(res.body.user.password).toBeUndefined();
  });

  it("rejects a duplicate email", async () => {
    const body = uniqueStudent();
    await request(app).post("/api/auth/signup/student").send(body);
    const dup = await request(app).post("/api/auth/signup/student").send(body);
    expect(dup.status).toBe(409);
  });

  it("signs up every role with only name, email, phone and password", async () => {
    for (const role of ["student", "teacher", "parent"]) {
      const res = await request(app)
        .post(`/api/auth/signup/${role}`)
        .send({ name: "Min " + role, email: `min-${role}-${Date.now()}@x.com`, phone: "9876543210", password: "Secret@123" });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe(role);
    }
  });

  it("rejects signup missing required fields", async () => {
    const res = await request(app)
      .post("/api/auth/signup/student")
      .send({ email: "x@y.com", password: "p" });
    expect(res.status).toBe(400);
  });
});

describe("Auth, login (email + password, no OTP)", () => {
  it("logs in with correct credentials", async () => {
    const body = uniqueStudent();
    await request(app).post("/api/auth/signup/student").send(body);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: body.email, password: body.password, role: "student" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe("student");
    // A refresh cookie should be set.
    const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith("edulearn_refresh="))).toBe(true);
  });

  it("does NOT require an OTP (gate disabled), login succeeds immediately", async () => {
    const body = uniqueStudent();
    await request(app).post("/api/auth/signup/student").send(body);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: body.email, password: body.password });
    // No VERIFICATION_REQUIRED, straight 200 with a token.
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
    expect(res.body.accessToken).toBeTruthy();
  });

  it("rejects a wrong password with 401", async () => {
    const body = uniqueStudent();
    await request(app).post("/api/auth/signup/student").send(body);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: body.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401 (no account leak)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@nowhere.com", password: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects logging in under the wrong role tab with 403", async () => {
    const body = uniqueStudent();
    await request(app).post("/api/auth/signup/student").send(body);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: body.email, password: body.password, role: "teacher" });
    expect(res.status).toBe(403);
  });
});

describe("Auth, refresh + me", () => {
  it("refreshes an access token from the refresh cookie", async () => {
    const body = uniqueTeacher();
    const signup = await request(app).post("/api/auth/signup/teacher").send(body);
    const cookies = signup.headers["set-cookie"] as unknown as string[];

    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("rejects refresh with no cookie", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("GET /me returns the authenticated user and requires a token", async () => {
    const body = uniqueStudent();
    const signup = await request(app).post("/api/auth/signup/student").send(body);
    const token = signup.body.accessToken as string;

    const ok = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${token}` });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(body.email.toLowerCase());

    const noAuth = await request(app).get("/api/auth/me");
    expect(noAuth.status).toBe(401);
  });
});
