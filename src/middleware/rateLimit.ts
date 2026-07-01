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

// OTP send/verify is unauthenticated and abuse-prone (SMS/email cost, brute
// force). Cap per IP. Keyed by IP since there's no user session yet.
export const otpLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 OTP requests / 15 min / IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "anon",
  message: { error: "Too many requests — please try again later." },
});

// Login/signup are unauthenticated and the prime target for credential
// stuffing / brute-force. Cap per IP. Deliberately stricter than general
// traffic but loose enough not to lock out a legitimate user who mistypes.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 20, // 20 attempts / 15 min / IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "anon",
  message: { error: "Too many attempts — please try again later." },
});
