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
  let video;
  try {
    video = await Video.create({
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
  } catch (err) {
    // The file already made it to disk even though the DB write failed
    // (e.g. a transient Mongo error) — without this it's an orphaned file
    // AND a generic 500 with no cleanup, on top of whatever upload error
    // the teacher was already retrying past.
    fs.unlink(path.join(UPLOAD_DIR, file.filename), () => {});
    throw err;
  }

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

// Filler words that carry no chapter identity — dropped before matching so
// "Sources of Food" and "food sources" compare as the same two words.
const TOPIC_STOPWORDS = new Set(["of", "the", "a", "an", "to", "and", "or", "in", "on", "for", "with"]);

function topicWords(v: unknown): string[] {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ") // punctuation → space
    .split(/\s+/)
    .filter((w) => w && !TOPIC_STOPWORDS.has(w));
}

// Match a chapter's search term against a video's free-text topic. Teachers
// type the topic by hand, so word order and filler drift ("Sources of Food",
// "Introduction to Food Sources") relative to the chapter slug the lesson hub
// sends ("food sources"). Compare the significant words as sets and accept when
// one side's words are all contained in the other — a plain substring test
// missed every reorder or added descriptor, so real uploads never appeared
// under their chapter. Both empty → no match (an untagged video is not claimed
// by every chapter).
function topicMatches(wantTopic: string, videoTopic: unknown): boolean {
  const want = topicWords(wantTopic);
  const have = topicWords(videoTopic);
  if (!want.length || !have.length) return false;
  const haveSet = new Set(have);
  const wantSet = new Set(want);
  return want.every((w) => haveSet.has(w)) || have.every((w) => wantSet.has(w));
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
    if (wantTopic !== null && !topicMatches(wantTopic, v.topic)) return false;
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

// PATCH /api/videos/:id — edit a video's metadata (teacher). Only the
// safe text fields; the file itself is never changed here. An admin may edit
// any video; a teacher may edit only videos they uploaded.
export async function updateVideo(req: AuthRequest, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const video = await Video.findById(req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const user = req.user;
  if (String(video.uploadedById) !== String(user?.id)) {
    res.status(403).json({ error: "You can only edit your own videos" });
    return;
  }

  const { title, description, className, subject, topic } = req.body;
  if (typeof title === "string" && title.trim()) video.title = title.trim();
  if (typeof description === "string") video.description = description;
  if (typeof className === "string" && className.trim()) video.className = className.trim();
  if (typeof subject === "string" && subject.trim()) video.subject = subject.trim();
  if (typeof topic === "string") video.topic = topic;
  await video.save();

  res.json({ video });
}

// DELETE /api/videos/:id — remove a video (teacher/admin) and its file on disk.
// Admin may delete any video; a teacher only their own.
export async function deleteVideo(req: AuthRequest, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const video = await Video.findById(req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const user = req.user;
  if (String(video.uploadedById) !== String(user?.id)) {
    res.status(403).json({ error: "You can only delete your own videos" });
    return;
  }

  // Best-effort remove the file from disk, then the DB record.
  if (video.filename) {
    fs.unlink(path.join(UPLOAD_DIR, video.filename), () => {});
  }
  await video.deleteOne();
  res.json({ ok: true, deleted: req.params.id });
}
