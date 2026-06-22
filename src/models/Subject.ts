import mongoose, { Schema, Document } from "mongoose";

// A subject scopes a set of chapters to a class (and optionally a board),
// e.g. "Mathematics" for CBSE Class 7.
export interface ISubject extends Document {
  name: string;
  slug: string; // stable key, e.g. "maths-class-7"
  board: string; // "CBSE" | "ICSE" | "State" | ""
  className: string; // "Class 7"
  description: string;
  createdById: mongoose.Types.ObjectId;
  createdByRole: "teacher" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

const subjectSchema = new Schema<ISubject>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    board: { type: String, default: "" },
    className: { type: String, required: true, index: true },
    description: { type: String, default: "" },
    createdById: { type: Schema.Types.ObjectId, ref: "User" },
    createdByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
  },
  { timestamps: true }
);

export const Subject = mongoose.model<ISubject>("Subject", subjectSchema);
