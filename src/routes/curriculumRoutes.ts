import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  listSubjects,
  createSubject,
  listChapters,
  getChapter,
  createChapter,
  updateChapter,
  deleteChapter,
} from "../controllers/curriculumController";

const router = Router();

router.use(requireAuth);

// Reads, any authenticated user.
router.get("/subjects", asyncHandler(listSubjects));
router.get("/subjects/:subjectId/chapters", asyncHandler(listChapters));
router.get("/chapters/:id", asyncHandler(getChapter));

// Writes, teachers (and admins) only.
router.post("/subjects", requireRole("teacher"), asyncHandler(createSubject));
router.post("/chapters", requireRole("teacher"), asyncHandler(createChapter));
router.patch("/chapters/:id", requireRole("teacher"), asyncHandler(updateChapter));
router.delete("/chapters/:id", requireRole("teacher"), asyncHandler(deleteChapter));

export default router;
