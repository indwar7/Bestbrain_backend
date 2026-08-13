import crypto from "crypto";
import { IUser } from "../models/User";
import { OtpCode } from "../models/OtpCode";
import { env } from "../config/env";
import { sendEmail, sendSms } from "./notifier";

const OTP_TTL_MS = 10 * 60 * 1000; // codes valid for 10 minutes
const MAX_ATTEMPTS = 5; // wrong guesses before a code is locked
const RESEND_COOLOFF_MS = 30 * 1000; // min gap between sends per channel

type Channel = "email" | "phone";
// What a code entitles its holder to do. Codes are scoped to one purpose so a
// verification code can never be spent on a password reset, and vice versa.
export type Purpose = "verify" | "reset";

function generateCode(): string {
  // 6-digit, zero-padded, cryptographically random.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export interface SendOtpResult {
  sent: boolean;
  via: string;
  // In dev (no real provider), we surface the code so the flow is testable.
  devCode?: string;
  cooloff?: boolean;
}

// Create + send a fresh OTP for one channel. Enforces a short resend cool-off.
export async function sendOtp(
  user: IUser,
  channel: Channel,
  purpose: Purpose = "verify"
): Promise<SendOtpResult> {
  const destination = channel === "email" ? user.email : user.phone;
  if (!destination) {
    throw new Error(`User has no ${channel} on file`);
  }

  // Cool-off: block rapid re-sends for the same user+channel+purpose.
  const recent = await OtpCode.findOne({ userId: user._id, channel, purpose }).sort({
    createdAt: -1,
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLOFF_MS) {
    return { sent: false, via: "cooloff", cooloff: true };
  }

  const code = generateCode();
  await OtpCode.create({
    userId: user._id,
    channel,
    purpose,
    destination,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  // Say what the code is for. A reset code arriving labelled "verification"
  // gives the reader no way to notice a reset they did not ask for.
  const message =
    purpose === "reset"
      ? `Your BestBrain password reset code is ${code}. It expires in 10 minutes. ` +
        `If you did not ask to reset your password, ignore this message and your password stays unchanged.`
      : `Your BestBrain verification code is ${code}. It expires in 10 minutes.`;

  // A provider failure (e.g. unverified recipient on a trial plan) must not
  // crash the request — the code is already stored, only delivery failed. We
  // log it and, outside production, surface the code so the flow stays testable.
  let delivered = false;
  let via = "none";
  try {
    const subject =
      purpose === "reset" ? "BestBrain password reset code" : "BestBrain verification code";
    const result =
      channel === "email"
        ? await sendEmail(destination, subject, message)
        : await sendSms(destination, message);
    delivered = result.delivered;
    via = result.via;
  } catch (err) {
    console.error(`OTP ${channel} delivery failed:`, (err as Error).message);
    via = "error";
  }

  // Expose the code only when no real provider delivered it (dev convenience),
  // and never in production.
  const exposeDev = !delivered && !env.isProd;
  return { sent: true, via, devCode: exposeDev ? code : undefined };
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "too_many" | "mismatch" };

// Check a submitted code against the latest active OTP for the channel.
export async function verifyOtp(
  user: IUser,
  channel: Channel,
  code: string,
  purpose: Purpose = "verify"
): Promise<VerifyOutcome> {
  const otp = await OtpCode.findOne({
    userId: user._id,
    channel,
    purpose,
    consumedAt: { $exists: false },
  }).sort({ createdAt: -1 });

  if (!otp) return { ok: false, reason: "no_code" };
  if (otp.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (otp.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many" };

  if (otp.codeHash !== hashCode(String(code).trim())) {
    otp.attempts += 1;
    await otp.save();
    return { ok: false, reason: "mismatch" };
  }

  // Success — consume this code so it cannot be replayed.
  otp.consumedAt = new Date();
  await otp.save();

  // Only a "verify" code proves the user owns the channel. A reset code is
  // proof of the same thing in practice, but treating it as verification
  // would let the reset flow quietly complete onboarding, so the two stay
  // separate and each does exactly what it says.
  if (purpose === "verify") {
    if (channel === "email") user.emailVerified = true;
    else user.phoneVerified = true;
    await user.save();
  }

  return { ok: true };
}

// A user counts as verified when their required channels are confirmed.
// Both email and phone are mandatory.
export function isUserVerified(user: IUser): boolean {
  return user.emailVerified && user.phoneVerified;
}
