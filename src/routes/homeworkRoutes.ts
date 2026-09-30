import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { requireAuthViaQueryToken } from "../middleware/authViaQueryToken";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createHomework,
  listHomework,
  updateHomework,
  deleteHomework,
  homeworkSubmissions,
  assignedHomework,
  getHomeworkForStudent,
  submitHomework,
  uploadHomeworkAnswers,
  downloadHomeworkAnswers,
  HOMEWORK_UPLOAD_DIR,
} from "../controllers/homeworkController";

const router = Router();

fs.mkdirSync(HOMEWORK_UPLOAD_DIR, { recursive: true });
const answersUpload = multer({
  storage: multer.diskStorage({
    destination: HOMEWORK_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, Date.now() + "-" + safe);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB: a phone-scanned PDF of a few pages
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only a PDF or a photo can be uploaded"));
  },
});

// Opened from a link (a new tab), so the token rides the query string; this is
// registered before the header-token middleware below.
router.get("/:id/upload/file", requireAuthViaQueryToken, asyncHandler(downloadHomeworkAnswers));

router.use(requireAuth);

/*
  Order matters here. "/assigned" is a literal path but it would also match
  "/:id", and Express takes the first route that matches, registered the other
  way round, a student asking for their homework list would be treated as
  asking for the assignment whose id is the word "assigned", and get a 404.
*/
router.get("/assigned", asyncHandler(assignedHomework));

// Authoring, teachers/admins.
router.post("/", requireRole("teacher"), asyncHandler(createHomework));
router.get("/", requireRole("teacher"), asyncHandler(listHomework));
router.patch("/:id", requireRole("teacher"), asyncHandler(updateHomework));
router.delete("/:id", requireRole("teacher"), asyncHandler(deleteHomework));
router.get("/:id/submissions", requireRole("teacher"), asyncHandler(homeworkSubmissions));

// Doing the work, students.
router.get("/:id", asyncHandler(getHomeworkForStudent));
router.post("/:id/submit", asyncHandler(submitHomework));
router.post("/:id/upload", answersUpload.single("file"), asyncHandler(uploadHomeworkAnswers));

export default router;
