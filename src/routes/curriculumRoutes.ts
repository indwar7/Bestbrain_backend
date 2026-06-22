import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
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

// Reads — any authenticated user.
router.get("/subjects", listSubjects);
router.get("/subjects/:subjectId/chapters", listChapters);
router.get("/chapters/:id", getChapter);

// Writes — teachers (and admins) only.
router.post("/subjects", requireRole("teacher"), createSubject);
router.post("/chapters", requireRole("teacher"), createChapter);
router.patch("/chapters/:id", requireRole("teacher"), updateChapter);
router.delete("/chapters/:id", requireRole("teacher"), deleteChapter);

export default router;
