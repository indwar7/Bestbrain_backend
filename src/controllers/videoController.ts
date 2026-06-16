import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Video } from "../models/Video";
import { AuthRequest } from "../middleware/auth";

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

// GET /api/videos — list videos, optionally filtered by ?className= & ?subject=
export async function listVideos(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.className) filter.className = req.query.className;
  if (req.query.subject) filter.subject = req.query.subject;

  const videos = await Video.find(filter).sort({ createdAt: -1 }).lean();
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
export async function streamVideo(req: Request, res: Response): Promise<void> {
  const video = await Video.findById(req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
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
    // Partial content — lets the browser seek.
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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
export async function recordView(req: Request, res: Response): Promise<void> {
  await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
  res.json({ ok: true });
}
