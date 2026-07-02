import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createSession,
  listSessions,
  joinSession,
  getVideoToken,
  getRoster,
  endSession,
} from "../controllers/liveController";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(listSessions)); // eligible sessions for the current user
router.post("/", requireRole("teacher"), asyncHandler(createSession)); // teacher only
router.post("/:id/join", asyncHandler(joinSession)); // eligibility-checked join
router.post("/:id/token", asyncHandler(getVideoToken)); // LiveKit video token (eligibility-checked)
router.get("/:id/roster", requireRole("teacher"), asyncHandler(getRoster)); // teacher only — class roster + presence
router.post("/:id/end", requireRole("teacher"), asyncHandler(endSession)); // teacher only

export default router;
