import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Video } from "../models/Video";
import { User } from "../models/User";
import { AuthRequest } from "../middleware/auth";
import { canViewVideo } from "../services/videoEligibility";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "videos");

// POST /api/videos — upload a video (teacher or admin). multer puts file on req.file.
export async function uploadVideo(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "No video file uploaded" });
    return;
  }

  const { title, description, className, subject, topic } = req.body;
  if (!title || !className || !subject) {
    // Clean up the orphaned file.
    fs.unlink(path.join(UPLOAD_DIR, file.filename), () => {});
    res.status(400).json({ error: "title, className and subject are required" });
    return;
  }

  const user = req.user;
  const video = await Video.create({
    title,
    description: description || "",
    className,
    subject,
    topic: topic || "",
    filename: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    uploadedById: user?.id,
    uploadedByName: req.body.uploaderName || user?.email || "",
    uploadedByRole: user?.role === "teacher" ? "teacher" : "admin",
  });

  res.status(201).json({ video });
}

// Class is stored inconsistently across callers ("Class 7", "7", 7) — compare
// by the digits only so a lookup from either shape still matches.
function classDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// Subject likewise varies in case/casing ("Science", "science") — compare
// case-insensitively on the first word so "Social Studies" still matches "social".
function normalizeSubject(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

// GET /api/videos — list videos, optionally filtered by ?className= & ?subject=
// & ?topic=. Filtering is done in-memory (not via a Mongo query) because
// className/subject are free-text and stored in inconsistent shapes
// ("Class 7" vs "7", "Science" vs "science") depending on which UI wrote them.
export async function listVideos(req: Request, res: Response): Promise<void> {
  const wantClass = req.query.className ? classDigits(req.query.className) : null;
  const wantSubject = req.query.subject ? normalizeSubject(req.query.subject) : null;
  const wantTopic = req.query.topic
    ? String(req.query.topic).trim().toLowerCase()
    : null;

  const all = await Video.find().sort({ createdAt: -1 }).lean();
  const videos = all.filter((v) => {
    if (wantClass !== null && classDigits(v.className) !== wantClass) return false;
    if (wantSubject !== null && normalizeSubject(v.subject) !== wantSubject) return false;
    if (wantTopic !== null) {
      const topic = v.topic.trim().toLowerCase();
      // Loose match: the chapter slug's words should appear in the topic (or
      // vice versa) since topic is free text a teacher typed by hand.
      if (!topic || (!topic.includes(wantTopic) && !wantTopic.includes(topic))) return false;
    }
    return true;
  });

  res.json({
    total: videos.length,
    videos: videos.map((v) => ({
      id: String(v._id),
      title: v.title,
      description: v.description,
      className: v.className,
      subject: v.subject,
      topic: v.topic,
      uploadedByName: v.uploadedByName,
      uploadedByRole: v.uploadedByRole,
      views: v.views,
      size: v.size,
      createdAt: v.createdAt,
      streamUrl: `/api/videos/${String(v._id)}/stream`,
    })),
  });
}

// GET /api/videos/:id/stream — stream the video with HTTP range support (seeking).
// Requires auth + the same class/subject eligibility as everything else (a
// student can only stream lectures for their own class+subject, a parent only
// for a linked child's, a teacher can stream any). Previously this route had
// NO auth at all — any unauthenticated request could stream any video by id.
export async function streamVideo(req: AuthRequest, res: Response): Promise<void> {
  // Guard against a non-ObjectId id (findById would otherwise throw CastError).
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const video = await Video.findById(req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const viewer = await User.findById(req.user!.id);
  if (!viewer) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  let children: Awaited<ReturnType<typeof User.find>> | undefined;
  if (viewer.role === "parent") {
    children = await User.find({
      _id: { $in: viewer.childLinks.map((l) => l.studentId) },
      role: "student",
    });
  }
  const eligibility = canViewVideo(viewer, video, children);
  if (!eligibility.allowed) {
    res.status(403).json({ error: eligibility.reason ?? "Not eligible to view this lecture" });
    return;
  }

  const filePath = path.join(UPLOAD_DIR, video.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Video file missing on server" });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Partial content — lets the browser seek. Validate + clamp the range so a
    // malformed/out-of-bounds header returns 416 instead of streaming garbage
    // (negative chunk size) or throwing on a NaN start.
    const parts = range.replace(/bytes=/, "").split("-");
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end)) end = fileSize - 1;
    if (start > end || start >= fileSize || start < 0) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      res.end();
      return;
    }
    end = Math.min(end, fileSize - 1);
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": video.mimeType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": video.mimeType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// POST /api/videos/:id/view — increment view count (called when a student plays it).
export async function recordView(req: AuthRequest, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
  res.json({ ok: true });
}
