import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { AuthRequest } from "./auth";

// Disable rate limiting under test so suites that hammer auth endpoints from a
// single IP aren't throttled. Production/dev behave normally.
const isTest = process.env.NODE_ENV === "test";

// IPv6-safe IP key. Using req.ip directly lets IPv6 clients bypass limits by
// varying the low bits; ipKeyGenerator normalises to a /64 subnet.
function ipKey(req: { ip?: string }): string {
  return ipKeyGenerator(req.ip ?? "anon");
}

// Per-user rate limit for PAL chat - Gemini calls cost money, so cap how fast a
// single account can fire them. Keyed by user id (falls back to IP) so one
// noisy user can't exhaust the budget for everyone.
export const palChatLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 20, // 20 messages / minute / user
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKey(req),
  message: { error: "Too many messages, please slow down and try again shortly." },
});

// OTP send/verify is unauthenticated and abuse-prone (SMS/email cost, brute
// force). Cap per IP. Keyed by IP since there's no user session yet.
export const otpLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 OTP requests / 15 min / IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: ipKey,
  message: { error: "Too many requests, please try again later." },
});

// Login/signup are unauthenticated and the prime target for credential
// stuffing / brute-force. Cap per IP. Deliberately stricter than general
// traffic but loose enough not to lock out a legitimate user who mistypes.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 20, // 20 attempts / 15 min / IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: ipKey,
  message: { error: "Too many attempts, please try again later." },
});
