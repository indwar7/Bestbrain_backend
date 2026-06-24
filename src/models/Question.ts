import mongoose, { Schema, Document } from "mongoose";

// A multiple-choice question, used by both Mock Tests and the hourly Challenge.
// `correctIndex` is never sent to students — the controllers strip it.
export interface IQuestion extends Document {
  className: string; // e.g. "Class 7"
  subject: string; // e.g. "Maths"
  chapterSlug?: string; // optional link to a Chapter
  text: string;
  options: string[]; // 2–6 options
  correctIndex: number; // index into options
  explanation: string; // shown after answering
  difficulty: "easy" | "medium" | "hard";
  usage: "mock" | "challenge" | "both";
  createdById?: mongoose.Types.ObjectId;
  createdByRole: "teacher" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    chapterSlug: { type: String, default: "" },
    text: { type: String, required: true, trim: true },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length >= 2 && v.length <= 6,
        message: "A question needs 2 to 6 options",
      },
    },
    correctIndex: { type: Number, required: true, min: 0 },
    explanation: { type: String, default: "" },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    usage: { type: String, enum: ["mock", "challenge", "both"], default: "both" },
    createdById: { type: Schema.Types.ObjectId, ref: "User" },
    createdByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
  },
  { timestamps: true }
);

questionSchema.index({ className: 1, subject: 1, difficulty: 1 });

export const Question = mongoose.model<IQuestion>("Question", questionSchema);
