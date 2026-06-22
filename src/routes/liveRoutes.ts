import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
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

router.get("/", listSessions); // eligible sessions for the current user
router.post("/", requireRole("teacher"), createSession); // teacher only
router.post("/:id/join", joinSession); // eligibility-checked join
router.post("/:id/token", getVideoToken); // LiveKit video token (eligibility-checked)
router.get("/:id/roster", requireRole("teacher"), getRoster); // teacher only — class roster + presence
router.post("/:id/end", requireRole("teacher"), endSession); // teacher only

export default router;
