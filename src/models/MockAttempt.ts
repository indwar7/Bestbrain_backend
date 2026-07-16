import mongoose, { Schema, Document } from "mongoose";

// A completed (or in-progress) mock-test attempt by a student.
export interface IMockAttempt extends Document {
  userId: mongoose.Types.ObjectId;
  className: string;
  subject: string;
  questionIds: mongoose.Types.ObjectId[]; // the questions served, in order
  answers: number[]; // chosen option index per question (-1 = unanswered)
  score: number; // correct count
  total: number;
  finished: boolean;
  startedAt: Date;
  finishedAt?: Date;
  testName?: string; // display name for client-side adaptive tests
  mastery?: number; // 0–100 mastery % (client engine may weight beyond raw score)
}

const mockAttemptSchema = new Schema<IMockAttempt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    className: { type: String, required: true },
    subject: { type: String, required: true },
    questionIds: { type: [Schema.Types.ObjectId], default: [] },
    answers: { type: [Number], default: [] },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    finished: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    testName: { type: String, default: "" },
    mastery: { type: Number, min: 0, max: 100 },
  },
  { timestamps: true }
);

mockAttemptSchema.index({ userId: 1, createdAt: -1 });

export const MockAttempt = mongoose.model<IMockAttempt>("MockAttempt", mockAttemptSchema);
