import mongoose, { Schema, Document } from "mongoose";

export interface IVideo extends Document {
  title: string;
  description: string;
  className: string; // e.g. "Class 6"
  subject: string; // e.g. "Maths"
  topic: string; // e.g. "Numericals"
  filename: string; // stored file name on disk
  mimeType: string;
  size: number;
  uploadedById: mongoose.Types.ObjectId;
  uploadedByName: string;
  uploadedByRole: "teacher" | "admin";
  views: number;
  createdAt: Date;
}

const videoSchema = new Schema<IVideo>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    topic: { type: String, default: "" },
    filename: { type: String, required: true },
    mimeType: { type: String, default: "video/mp4" },
    size: { type: Number, default: 0 },
    uploadedById: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedByName: { type: String, default: "" },
    uploadedByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
    views: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Video = mongoose.model<IVideo>("Video", videoSchema);
