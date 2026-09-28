import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
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

// Authoring, teachers/admins.
router.post("/questions", requireRole("teacher"), createQuestion);
router.get("/questions", requireRole("teacher"), listQuestions);

// Mock tests, students.
router.post("/mock/start", startMock);
router.post("/mock/:attemptId/submit", submitMock);
router.get("/mock/history", mockHistory);

// Hourly challenge, students.
router.get("/challenge", getChallenge);
router.post("/challenge/answer", answerChallenge);
router.get("/challenge/leaderboard", challengeLeaderboard);

export default router;
