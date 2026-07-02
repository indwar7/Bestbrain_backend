import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { palChatLimiter } from "../middleware/rateLimit";
import {
  chat,
  chatStream,
  listSessions,
  getSession,
  renameSession,
  deleteSession,
} from "../controllers/palController";

const router = Router();

router.use(requireAuth);

// Chat (rate-limited — Gemini calls cost money).
router.post("/chat", palChatLimiter, asyncHandler(chat));
router.post("/chat/stream", palChatLimiter, asyncHandler(chatStream)); // SSE streaming

// Session management.
router.get("/sessions", asyncHandler(listSessions));
router.get("/sessions/:id", asyncHandler(getSession));
router.patch("/sessions/:id", asyncHandler(renameSession));
router.delete("/sessions/:id", asyncHandler(deleteSession));

export default router;
