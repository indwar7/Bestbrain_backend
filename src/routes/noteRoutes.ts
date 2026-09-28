import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { requireAuth } from "../middleware/auth";
import { requireAuthViaQueryToken } from "../middleware/authViaQueryToken";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import { uploadNote, listNotes, downloadNote, deleteNote } from "../controllers/noteController";

const router = Router();

// Store uploaded notes on disk under uploads/notes with a unique name. multer
// does not create the destination, so ensure it exists (the dir is gitignored
// bar a .gitkeep, and won't be present on a fresh clone/deploy otherwise).
const NOTE_DIR = path.join(process.cwd(), "uploads", "notes");
fs.mkdirSync(NOTE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: NOTE_DIR,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, Date.now() + "-" + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap, notes are documents, not video
  fileFilter: (_req, file, cb) => {
    // PDFs primarily; also allow images (scanned/handwritten notes).
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only PDF or image files are allowed"));
  },
});

// Anyone logged in can browse the note list; the file route additionally
// enforces class/subject eligibility in the controller.
router.get("/", requireAuth, asyncHandler(listNotes));
// A plain <a href> can't send an Authorization header, so this media route also
// accepts ?token= (scoped to this route only, like video streaming).
router.get("/:id/file", requireAuthViaQueryToken, asyncHandler(downloadNote));

// Only teachers (admin treated as teacher here) can upload.
router.post("/", requireAuth, requireRole("teacher"), upload.single("note"), asyncHandler(uploadNote));

// Delete, teacher (own) or admin (any); ownership enforced in the controller.
router.delete("/:id", requireAuth, requireRole("teacher"), asyncHandler(deleteNote));

export default router;
