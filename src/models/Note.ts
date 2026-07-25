import mongoose, { Schema, Document } from "mongoose";

// A chapter note document (usually a PDF a teacher uploads). Deliberately
// parallel to Video: the lesson hub matches notes to a chapter by the same
// className + subject + free-text topic, and gates access with the same
// class/subject eligibility. Kept as its own collection rather than a field on
// Video because a chapter can have notes without a lecture, and vice versa.
export interface INote extends Document {
  title: string;
  description: string;
  className: string; // e.g. "Class 7"
  subject: string; // e.g. "Science"
  topic: string; // free text, matched loosely to a chapter (e.g. "Food Sources")
  filename: string; // stored file name on disk under uploads/notes
  mimeType: string;
  size: number;
  uploadedById: mongoose.Types.ObjectId;
  uploadedByName: string;
  uploadedByRole: "teacher" | "admin";
  downloads: number;
  createdAt: Date;
}

const noteSchema = new Schema<INote>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    topic: { type: String, default: "" },
    filename: { type: String, required: true },
    mimeType: { type: String, default: "application/pdf" },
    size: { type: Number, default: 0 },
    uploadedById: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedByName: { type: String, default: "" },
    uploadedByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
    downloads: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Note = mongoose.model<INote>("Note", noteSchema);
