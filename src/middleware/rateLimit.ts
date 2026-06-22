import rateLimit from "express-rate-limit";
import { AuthRequest } from "./auth";

// Per-user rate limit for PAL chat — Gemini calls cost money, so cap how fast a
// single account can fire them. Keyed by user id (falls back to IP) so one
// noisy user can't exhaust the budget for everyone.
export const palChatLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 20, // 20 messages / minute / user
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? "anon",
  message: { error: "Too many messages — please slow down and try again shortly." },
});
