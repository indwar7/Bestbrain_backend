import { Router } from "express";
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
} from "../controllers/homeworkController";

const router = Router();

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

export default router;
