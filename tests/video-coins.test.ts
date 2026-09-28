import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app";
import { Video } from "../src/models/Video";
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

async function makeVideo() {
  const v = await Video.create({
    title: "Photosynthesis",
    className: "Class 7",
    subject: "Science",
    filename: "photosynthesis.mp4",
  });
  return String(v._id);
}

describe("Video views, coin gate (students)", () => {
  it("charges 25 coins on the first view of a video", async () => {
    const { token } = await signupStudent(100);
    const videoId = await makeVideo();
    const res = await request(app).post(`/api/videos/${videoId}/view`).set(auth(token));
    expect(res.status).toBe(200);
    expect(await balanceOf(token)).toBe(75);
  });

  it("does not charge again for a second view of the SAME video", async () => {
    const { token } = await signupStudent(100);
    const videoId = await makeVideo();
    await request(app).post(`/api/videos/${videoId}/view`).set(auth(token));
    const second = await request(app).post(`/api/videos/${videoId}/view`).set(auth(token));
    expect(second.status).toBe(200);
    expect(await balanceOf(token)).toBe(75); // still just the one charge
  });

  it("charges again for a DIFFERENT video", async () => {
    const { token } = await signupStudent(100);
    const v1 = await makeVideo();
    const v2 = await makeVideo();
    await request(app).post(`/api/videos/${v1}/view`).set(auth(token));
    await request(app).post(`/api/videos/${v2}/view`).set(auth(token));
    expect(await balanceOf(token)).toBe(50);
  });

  it("blocks with 402 when the student has fewer than 25 coins, and does not record the view", async () => {
    const { token } = await signupStudent(10);
    const videoId = await makeVideo();
    const res = await request(app).post(`/api/videos/${videoId}/view`).set(auth(token));
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("insufficient_coins");
    expect(await balanceOf(token)).toBe(10);
    const video = await Video.findById(videoId);
    expect(video?.views).toBe(0);
  });

  it("does not charge a teacher for viewing a video", async () => {
    const token = await signupTeacher();
    const videoId = await makeVideo();
    const res = await request(app).post(`/api/videos/${videoId}/view`).set(auth(token));
    expect(res.status).toBe(200);
    const video = await Video.findById(videoId);
    expect(video?.views).toBe(1);
  });

  it("404s for a bogus video id and never charges for it", async () => {
    const { token } = await signupStudent(100);
    const res = await request(app)
      .post(`/api/videos/${new mongoose.Types.ObjectId()}/view`)
      .set(auth(token));
    expect(res.status).toBe(404);
    expect(await balanceOf(token)).toBe(100);
  });
});
