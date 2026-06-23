import { Request, Response } from "express";
import { User } from "../models/User";
import { sendOtp, verifyOtp } from "../services/otpService";

type Channel = "email" | "phone";

function validChannel(c: unknown): c is Channel {
  return c === "email" || c === "phone";
}

// Resolve the target user from either an authenticated session or, for the
// pre-login verification step, an email/userId in the body.
async function resolveUser(req: Request) {
  const body = req.body as { email?: string; userId?: string };
  if (body.userId) return User.findById(body.userId);
  if (body.email) return User.findOne({ email: body.email.toLowerCase() });
  return null;
}

// POST /api/auth/send-otp   Body: { channel, email? | userId? }
// Sends a fresh OTP to the user's email or phone.
export async function requestOtp(req: Request, res: Response): Promise<void> {
  try {
    const { channel } = req.body as { channel?: Channel };
    if (!validChannel(channel)) {
      res.status(400).json({ error: "channel must be 'email' or 'phone'" });
      return;
    }

    const user = await resolveUser(req);
    if (!user) {
      // Don't reveal whether an account exists.
      res.json({ sent: true });
      return;
    }

    const result = await sendOtp(user, channel);
    if (result.cooloff) {
      res.status(429).json({ error: "Please wait a moment before requesting another code." });
      return;
    }

    // devCode is only present when no real provider delivered it (non-prod).
    res.json({ sent: result.sent, via: result.via, devCode: result.devCode });
  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({ error: "Could not send code" });
  }
}

// POST /api/auth/verify-otp   Body: { channel, code, email? | userId? }
// Confirms a code and marks the channel verified.
export async function confirmOtp(req: Request, res: Response): Promise<void> {
  try {
    const { channel, code } = req.body as { channel?: Channel; code?: string };
    if (!validChannel(channel)) {
      res.status(400).json({ error: "channel must be 'email' or 'phone'" });
      return;
    }
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const outcome = await verifyOtp(user, channel, code);
    if (outcome.ok) {
      res.json({
        verified: true,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
      });
      return;
    }

    const messages: Record<string, string> = {
      no_code: "No active code. Please request a new one.",
      expired: "This code has expired. Please request a new one.",
      too_many: "Too many incorrect attempts. Please request a new code.",
      mismatch: "Incorrect code. Please try again.",
    };
    res.status(400).json({ verified: false, error: messages[outcome.reason] });
  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).json({ error: "Could not verify code" });
  }
}
