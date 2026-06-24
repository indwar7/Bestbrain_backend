import mongoose, { Schema, Document } from "mongoose";

// One student's answer to the hourly Challenge question. The "hour key" (e.g.
// "2026-06-23T09") makes one attempt per student per hour and powers the
// leaderboard for that hour. Speed is the anti-cheat: faster correct = higher.
export interface IChallengeAttempt extends Document {
  userId: mongoose.Types.ObjectId;
  userName: string; // denormalized for the leaderboard
  hourKey: string; // "YYYY-MM-DDTHH" (UTC)
  questionId: mongoose.Types.ObjectId;
  chosenIndex: number;
  correct: boolean;
  msTaken: number; // time from question shown to answer
  points: number; // computed: correct ? base + speed bonus : 0
  createdAt: Date;
}

const challengeAttemptSchema = new Schema<IChallengeAttempt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, default: "" },
    hourKey: { type: String, required: true, index: true },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    chosenIndex: { type: Number, required: true },
    correct: { type: Boolean, default: false },
    msTaken: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One attempt per user per hour.
challengeAttemptSchema.index({ userId: 1, hourKey: 1 }, { unique: true });
challengeAttemptSchema.index({ hourKey: 1, points: -1 }); // leaderboard

export const ChallengeAttempt = mongoose.model<IChallengeAttempt>(
  "ChallengeAttempt",
  challengeAttemptSchema
);
