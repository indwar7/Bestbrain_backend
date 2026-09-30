import mongoose, { Schema, Document } from "mongoose";

/**
 * A student's written answers to one homework, uploaded as a PDF or a photo.
 * One per student per homework: uploading again replaces the file.
 */
export interface IHomeworkUpload extends Document {
  homeworkId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  filename: string; // name on disk under uploads/homework
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

const homeworkUploadSchema = new Schema<IHomeworkUpload>({
  homeworkId: { type: Schema.Types.ObjectId, ref: "Homework", required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  filename: { type: String, required: true },
  originalName: { type: String, default: "" },
  mimeType: { type: String, required: true },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
});
homeworkUploadSchema.index({ homeworkId: 1, studentId: 1 }, { unique: true });

export const HomeworkUpload = mongoose.model<IHomeworkUpload>("HomeworkUpload", homeworkUploadSchema);
