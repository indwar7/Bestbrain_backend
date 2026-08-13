import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { sendOtp, verifyOtp } from "../services/otpService";

// Password reset, in two steps: ask for a code, then spend it on a new
// password. The code is an OTP scoped to purpose:"reset", so a code issued to
// confirm an email address cannot be used here.
//
// Reset goes to email only. The address is the one thing a student can be
// asked for while locked out and is what the account is keyed on; adding SMS
// would widen the attack surface for no gain the flow actually needs.

const MIN_PASSWORD = 6; // matches the signup forms' minlength

// POST /api/auth/forgot-password   Body: { email }
// Always answers the same way. Whether an account exists is not something an
// unauthenticated caller gets to learn — a differing response here turns this
// endpoint into a way to test which emails are registered.
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const ok = {
    sent: true,
    message: "If that email is registered, a reset code is on its way.",
  };

  try {
    const { email } = req.body as { email?: string };
    if (!email || !String(email).trim()) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      res.json(ok);
      return;
    }

    const result = await sendOtp(user, "email", "reset");
    if (result.cooloff) {
      res.status(429).json({
        error: "A code was just sent. Please wait a moment before asking for another.",
      });
      return;
    }

    // devCode is only ever populated when no real provider delivered the
    // message and we are not in production (see otpService).
    res.json({ ...ok, devCode: result.devCode });
  } catch (err) {
    console.error("forgot-password error:", err);
    // Even a failure keeps the same shape, for the same reason as above.
    res.json(ok);
  }
}

// POST /api/auth/reset-password   Body: { email, code, password }
// Spends a reset code and sets the new password.
export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email, code, password } = req.body as {
      email?: string;
      code?: string;
      password?: string;
    };

    if (!email || !code || !password) {
      res.status(400).json({ error: "email, code and password are required" });
      return;
    }
    if (String(password).length < MIN_PASSWORD) {
      res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
      return;
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    // A wrong code and an unknown email are reported identically, so this
    // endpoint cannot be used to enumerate accounts either.
    const bad = { error: "That code is not valid. Please request a new one." };
    if (!user) {
      res.status(400).json(bad);
      return;
    }

    const outcome = await verifyOtp(user, "email", String(code), "reset");
    if (!outcome.ok) {
      const messages: Record<string, string> = {
        no_code: "No active reset code. Please request a new one.",
        expired: "This code has expired. Please request a new one.",
        too_many: "Too many incorrect attempts. Please request a new code.",
        mismatch: "Incorrect code. Please try again.",
      };
      res.status(400).json({ error: messages[outcome.reason] ?? bad.error });
      return;
    }

    user.password = await bcrypt.hash(String(password), 10);
    await user.save();

    // The caller is not signed in here. Sending them to the login screen with
    // the new password is deliberate: it confirms the password works, and it
    // means a reset never mints a session for whoever happened to hold the
    // code.
    res.json({ reset: true, message: "Password updated. You can sign in now." });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Could not reset password" });
  }
}
