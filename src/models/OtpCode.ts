import mongoose, { Schema, Document } from "mongoose";

// A one-time verification code tied to a user and a channel (email or phone).
// The code itself is stored hashed; we never persist the plaintext OTP.
export interface IOtpCode extends Document {
  userId: mongoose.Types.ObjectId;
  channel: "email" | "phone";
  // What the code entitles the holder to do. Without this a code sent to
  // confirm an email address would also open a password reset, the two
  // flows would share one pool of codes, and the weaker one sets the bar.
  purpose: "verify" | "reset";
  destination: string; // the email or phone the code was sent to
  codeHash: string; // sha256 of the 6-digit code
  attempts: number; // wrong guesses so far
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

const otpCodeSchema = new Schema<IOtpCode>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channel: { type: String, enum: ["email", "phone"], required: true },
    // Defaults to "verify" so codes written before this field existed keep
    // their original, narrower meaning rather than silently becoming
    // password-reset codes.
    purpose: { type: String, enum: ["verify", "reset"], required: true, default: "verify" },
    destination: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// TTL index: Mongo auto-deletes documents once expiresAt passes.
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Quick lookup of the latest active code per user+channel+purpose.
otpCodeSchema.index({ userId: 1, channel: 1, purpose: 1, createdAt: -1 });

export const OtpCode = mongoose.model<IOtpCode>("OtpCode", otpCodeSchema);
