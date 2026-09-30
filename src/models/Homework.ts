import mongoose, { Schema, Document } from "mongoose";

/**
 * A set of questions a teacher assigns to one class for one chapter.
 *
 * This is deliberately not a mock test. A mock test is something a student
 * starts when they choose to and is scored against the clock; homework is
 * handed out, has a date attached, and is still worth submitting after that
 * date has passed. Those are different enough that sharing MockAttempt would
 * mean a `dueAt` that is null for most rows and a status nothing else reads.
 *
 * The questions are referenced rather than copied so a teacher fixing a typo
 * fixes it everywhere. The consequence is that editing a question changes work
 * already submitted against it; submissions therefore record the answer the
 * student gave AND whether it was right at the time, so a later edit cannot
 * silently rewrite a mark.
 *
 * `isPublished` is what separates a draft from assigned work. Students only
 * ever see published homework for their own class, see the query in
 * homeworkController, which takes className from the signed-in user and never
 * from the request.
 */
export interface IHomework extends Document {
  className: string; // e.g. "Class 6"
  subject: string; // e.g. "Science"
  chapterSlug: string; // e.g. "food-sources"
  title: string;
  instructions: string;
  questionIds: mongoose.Types.ObjectId[];
  writtenQuestions: string[]; // answered on paper and uploaded as a PDF
  dueAt: Date;
  assignedById: mongoose.Types.ObjectId;
  assignedByRole: "teacher" | "admin";
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const homeworkSchema = new Schema<IHomework>(
  {
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    chapterSlug: { type: String, default: "", index: true },
    title: { type: String, required: true, trim: true },
    instructions: { type: String, default: "" },
    questionIds: { type: [Schema.Types.ObjectId], ref: "Question", default: [] },
    writtenQuestions: { type: [String], default: [] },
    dueAt: { type: Date, required: true },
    assignedById: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedByRole: { type: String, enum: ["teacher", "admin"], default: "teacher" },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// The student's list: their class and subject, soonest due first.
homeworkSchema.index({ className: 1, subject: 1, dueAt: 1 });

export const Homework = mongoose.model<IHomework>("Homework", homeworkSchema);
