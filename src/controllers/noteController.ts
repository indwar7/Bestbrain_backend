import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Note } from "../models/Note";
import { User } from "../models/User";
import { AuthRequest } from "../middleware/auth";
import { canViewVideo } from "../services/videoEligibility";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "notes");

// POST /api/notes — upload a chapter note (teacher or admin). multer puts the
// file on req.file.
export async function uploadNote(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "No note file uploaded" });
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
  let note;
  try {
    note = await Note.create({
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
    // The file already made it to disk even though the DB write failed — remove
    // the orphan instead of leaving it and returning a bare 500.
    fs.unlink(path.join(UPLOAD_DIR, file.filename), () => {});
    throw err;
  }

  res.status(201).json({ note });
}

// Class/subject/topic are stored as free text in inconsistent shapes; compare
// the same way the video lookup does so a chapter finds its notes regardless of
// how the uploader typed them. (Duplicated from videoController, matching the
// existing pattern where these tiny helpers live next to each controller.)
function classDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}
function normalizeSubject(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}
const TOPIC_STOPWORDS = new Set(["of", "the", "a", "an", "to", "and", "or", "in", "on", "for", "with"]);
function topicWords(v: unknown): string[] {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !TOPIC_STOPWORDS.has(w));
}
function topicMatches(wantTopic: string, noteTopic: unknown): boolean {
  const want = topicWords(wantTopic);
  const have = topicWords(noteTopic);
  if (!want.length || !have.length) return false;
  const haveSet = new Set(have);
  const wantSet = new Set(want);
  return want.every((w) => haveSet.has(w)) || have.every((w) => wantSet.has(w));
}

// GET /api/notes — list notes, optionally filtered by ?className= & ?subject=
// & ?topic=. Filtered in-memory for the same reason videos are: the fields are
// free text stored in inconsistent shapes.
export async function listNotes(req: Request, res: Response): Promise<void> {
  const wantClass = req.query.className ? classDigits(req.query.className) : null;
  const wantSubject = req.query.subject ? normalizeSubject(req.query.subject) : null;
  const wantTopic = req.query.topic ? String(req.query.topic).trim().toLowerCase() : null;

  const all = await Note.find().sort({ createdAt: -1 }).lean();
  const notes = all.filter((n) => {
    if (wantClass !== null && classDigits(n.className) !== wantClass) return false;
    if (wantSubject !== null && normalizeSubject(n.subject) !== wantSubject) return false;
    if (wantTopic !== null && !topicMatches(wantTopic, n.topic)) return false;
    return true;
  });

  res.json({
    total: notes.length,
    notes: notes.map((n) => ({
      id: String(n._id),
      title: n.title,
      description: n.description,
      className: n.className,
      subject: n.subject,
      topic: n.topic,
      uploadedByName: n.uploadedByName,
      uploadedByRole: n.uploadedByRole,
      downloads: n.downloads,
      size: n.size,
      mimeType: n.mimeType,
      createdAt: n.createdAt,
      fileUrl: `/api/notes/${String(n._id)}/file`,
    })),
  });
}

// GET /api/notes/:id/file — serve the note file, gated by the same class/subject
// eligibility as lecture videos. A plain <a> can't send an Authorization
// header, so this route accepts the token as ?token= (requireAuthViaQueryToken),
// exactly like video streaming.
export async function downloadNote(req: AuthRequest, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const note = await Note.findById(req.params.id);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
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
  // Notes carry the same class/subject identity as videos, so the lecture
  // eligibility rule applies unchanged.
  const eligibility = canViewVideo(
    viewer,
    { uploadedById: note.uploadedById, className: note.className, subject: note.subject },
    children
  );
  if (!eligibility.allowed) {
    res.status(403).json({ error: eligibility.reason ?? "Not eligible to view these notes" });
    return;
  }

  const filePath = path.join(UPLOAD_DIR, note.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Note file missing on server" });
    return;
  }

  // Count a download, then serve inline so a PDF opens in the browser tab.
  await Note.updateOne({ _id: note._id }, { $inc: { downloads: 1 } });

  const safeName = (note.title || "notes").replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
  const ext = note.mimeType === "application/pdf" ? ".pdf" : path.extname(note.filename);
  res.setHeader("Content-Type", note.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${safeName}${ext}"`);
  res.setHeader("Content-Length", String(fs.statSync(filePath).size));
  fs.createReadStream(filePath).pipe(res);
}

// DELETE /api/notes/:id — the uploader can delete their own note (mirrors the
// video delete rule, which is ownership-only).
export async function deleteNote(req: AuthRequest, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const note = await Note.findById(req.params.id);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (String(note.uploadedById) !== String(req.user?.id)) {
    res.status(403).json({ error: "You can only delete your own notes" });
    return;
  }
  await Note.deleteOne({ _id: note._id });
  fs.unlink(path.join(UPLOAD_DIR, note.filename), () => {});
  res.json({ ok: true });
}
