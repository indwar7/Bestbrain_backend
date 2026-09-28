import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createQuestion,
  listQuestions,
  startMock,
  answerMockQuestion,
  submitMock,
  recordMockAttempt,
  mockHistory,
  getChallenge,
  answerChallenge,
  challengeLeaderboard,
  getBank,
  answerBankQuestion,
  bankChapterCounts,
} from "../controllers/assessmentController";

const router = Router();

router.use(requireAuth);

// Authoring, teachers/admins.
router.post("/questions", requireRole("teacher"), asyncHandler(createQuestion));
router.get("/questions", requireRole("teacher"), asyncHandler(listQuestions));

// Mock tests, students.
router.post("/mock/start", asyncHandler(startMock));
router.post("/mock/record", asyncHandler(recordMockAttempt));
router.post("/mock/:attemptId/answer", asyncHandler(answerMockQuestion));
router.post("/mock/:attemptId/submit", asyncHandler(submitMock));
router.get("/mock/history", asyncHandler(mockHistory));

// Question bank, students. Untimed chapter practice; no attempt is recorded,
// so there is nothing to start or submit, only fetch and grade.
router.get("/bank", asyncHandler(getBank));
router.get("/bank/chapters", asyncHandler(bankChapterCounts));
router.post("/bank/answer", asyncHandler(answerBankQuestion));

// Hourly challenge, students.
router.get("/challenge", asyncHandler(getChallenge));
router.post("/challenge/answer", asyncHandler(answerChallenge));
router.get("/challenge/leaderboard", asyncHandler(challengeLeaderboard));

export default router;
