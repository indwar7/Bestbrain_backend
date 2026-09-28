import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireAuth } from "../middleware/auth";
import { requireAuthViaQueryToken } from "../middleware/authViaQueryToken";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  uploadVideo,
  listVideos,
  streamVideo,
  recordView,
  updateVideo,
  deleteVideo,
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

// Anyone logged in can browse. Streaming/view-count additionally require the
// requester to be eligible for this specific video's class+subject (checked
// in the controller), previously these had no auth at all.
router.get("/", requireAuth, asyncHandler(listVideos));
// <video src="..."> can't send an Authorization header, so this route also
// accepts the token as ?token= (query-param auth is scoped to this one
// unauthenticated-by-nature media route, not general API auth).
router.get("/:id/stream", requireAuthViaQueryToken, asyncHandler(streamVideo));
router.post("/:id/view", requireAuth, asyncHandler(recordView));

// Only teachers (admin treated as teacher here) can upload.
router.post(
  "/",
  requireAuth,
  requireRole("teacher"),
  upload.single("video"),
  asyncHandler(uploadVideo)
);

// Edit / delete a video, teacher or admin (ownership enforced in controller).
router.patch("/:id", requireAuth, requireRole("teacher"), asyncHandler(updateVideo));
router.delete("/:id", requireAuth, requireRole("teacher"), asyncHandler(deleteVideo));

export default router;
