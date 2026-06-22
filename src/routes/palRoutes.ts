import { Router } from "express";
import { requireAuth } from "../middleware/auth";
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
router.post("/chat", palChatLimiter, chat);
router.post("/chat/stream", palChatLimiter, chatStream); // SSE streaming

// Session management.
router.get("/sessions", listSessions);
router.get("/sessions/:id", getSession);
router.patch("/sessions/:id", renameSession);
router.delete("/sessions/:id", deleteSession);

export default router;
