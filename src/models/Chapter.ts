import mongoose, { Schema, Document } from "mongoose";

// A chapter is a unit of content within a subject. `slug` is the stable key that
// progress events reference as `chapterId`, it's backward-compatible with the
// free-form keys used before curriculum management existed (e.g. "ch-fractions").
export interface IChapter extends Document {
  subjectId: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  order: number; // position within the subject (1-based)
  description: string;
  estimatedMinutes: number;
  prerequisites: string[]; // chapter slugs that should come first
  lessonContent: string; // lesson body shown in the player (markdown/plain)
  videoUrl: string; // optional lecture video link
  isPublished: boolean;
  createdById: mongoose.Types.ObjectId;
  createdByRole: "teacher" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

const chapterSchema = new Schema<IChapter>(
  {
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: "" },
    estimatedMinutes: { type: Number, default: 0 },
    prerequisites: { type: [String], default: [] },
    lessonContent: { type: String, default: "" },
    videoUrl: { type: String, default: "" },
    isPublished: { type: Boolean, default: true },
    createdById: { type: Schema.Types.ObjectId, ref: "User" },
    createdByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
  },
  { timestamps: true }
);

// A slug is unique within a subject (the same slug can exist under two subjects).
chapterSchema.index({ subjectId: 1, slug: 1 }, { unique: true });
chapterSchema.index({ subjectId: 1, order: 1 });

export const Chapter = mongoose.model<IChapter>("Chapter", chapterSchema);
