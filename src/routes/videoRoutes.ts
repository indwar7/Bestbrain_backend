import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import {
  uploadVideo,
  listVideos,
  streamVideo,
  recordView,
} from "../controllers/videoController";

const router = Router();

// Store uploaded videos on disk under uploads/videos with a unique name.
const storage = multer.diskStorage({
  destination: path.join(process.cwd(), "uploads", "videos"),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, Date.now() + "-" + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed"));
  },
});

// Anyone logged in can browse + watch.
router.get("/", requireAuth, listVideos);
router.get("/:id/stream", streamVideo); // no auth so <video src> works directly
router.post("/:id/view", recordView);

// Only teachers (admin treated as teacher here) can upload.
router.post(
  "/",
  requireAuth,
  requireRole("teacher"),
  upload.single("video"),
  uploadVideo
);

export default router;
