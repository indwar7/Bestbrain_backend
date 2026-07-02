import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createQuestion,
  listQuestions,
  startMock,
  submitMock,
  mockHistory,
  getChallenge,
  answerChallenge,
  challengeLeaderboard,
} from "../controllers/assessmentController";

const router = Router();

router.use(requireAuth);

// Authoring — teachers/admins.
router.post("/questions", requireRole("teacher"), asyncHandler(createQuestion));
router.get("/questions", requireRole("teacher"), asyncHandler(listQuestions));

// Mock tests — students.
router.post("/mock/start", asyncHandler(startMock));
router.post("/mock/:attemptId/submit", asyncHandler(submitMock));
router.get("/mock/history", asyncHandler(mockHistory));

// Hourly challenge — students.
router.get("/challenge", asyncHandler(getChallenge));
router.post("/challenge/answer", asyncHandler(answerChallenge));
router.get("/challenge/leaderboard", asyncHandler(challengeLeaderboard));

export default router;
