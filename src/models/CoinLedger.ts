import mongoose, { Schema, Document } from "mongoose";

/**
 * One line per change to a student's coin balance.
 *
 * The balance on the user is the running total; this is the reason it holds
 * that value. Without it a balance is a number nobody can explain, not to a
 * student who thinks they earned more, and not to us when the two disagree.
 * Every row carries the balance it produced, so the whole history can be
 * replayed and checked against the user document.
 *
 * `refId` is what makes a change happen at most once. Earning uses the
 * progress event's own id, so replaying a synced event cannot pay twice;
 * spending uses an id chosen by the caller, so a retried request after a
 * dropped response does not charge twice either.
 */
export interface ICoinLedger extends Document {
  userId: mongoose.Types.ObjectId;
  delta: number; // + earned, − spent
  reason: string; // "chapter_completed", "spend:study-pdf", …
  refId: string; // unique per user; the thing that caused this line
  balanceAfter: number;
  createdAt: Date;
}

const coinLedgerSchema = new Schema<ICoinLedger>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    delta: { type: Number, required: true },
    reason: { type: String, required: true },
    refId: { type: String, required: true },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The idempotency guarantee. Two requests carrying the same refId for the same
// student cannot both be written, whichever of them arrives second.
coinLedgerSchema.index({ userId: 1, refId: 1 }, { unique: true });
// Newest-first history for one student.
coinLedgerSchema.index({ userId: 1, createdAt: -1 });

export const CoinLedger = mongoose.model<ICoinLedger>("CoinLedger", coinLedgerSchema);
