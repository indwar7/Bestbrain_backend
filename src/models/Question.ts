import mongoose, { Schema, Document } from "mongoose";

// A multiple-choice question, used by both Mock Tests and the hourly Challenge.
// `correctIndex` is never sent to students, the controllers strip it.
export interface IQuestion extends Document {
  className: string; // e.g. "Class 7"
  subject: string; // e.g. "Maths"
  chapterSlug?: string; // optional link to a Chapter
  text: string;
  options: string[]; // 2–6 options
  correctIndex: number; // index into options
  explanation: string; // shown after answering
  difficulty: "easy" | "medium" | "hard";
  // "bank" is the chapter practice pool: untimed, drilled as often as the
  // student likes. "both" stays what it always meant, a question the mock
  // test and the challenge may both draw, and the bank accepts it too, so
  // every question already seeded remains usable without a migration.
  usage: "mock" | "challenge" | "bank" | "both";
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
    usage: { type: String, enum: ["mock", "challenge", "bank", "both"], default: "both" },
    createdById: { type: Schema.Types.ObjectId, ref: "User" },
    createdByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
  },
  { timestamps: true }
);

questionSchema.index({ className: 1, subject: 1, difficulty: 1 });
// The bank and homework authoring both read one chapter at a time, which the
// index above cannot serve, it has no chapterSlug, so those queries scanned
// every question for the class and subject.
questionSchema.index({ className: 1, subject: 1, chapterSlug: 1, usage: 1 });

export const Question = mongoose.model<IQuestion>("Question", questionSchema);
