import mongoose, { Schema, Document } from "mongoose";

/**
 * One student's answers to one homework assignment.
 *
 * `isCorrect` is stored per answer rather than recomputed from the Question on
 * read. Homework references its questions, so a teacher correcting a wrong
 * correctIndex after work is submitted would otherwise change marks that had
 * already been given, silently, and only for students who had already
 * submitted. Recording the verdict at submission time means a mark is a fact
 * about what happened, not a re-derivation from data that has since moved.
 *
 * `status` distinguishes late work from on-time rather than rejecting it. Work
 * handed in after the due date is still work; the teacher wants it, flagged.
 *
 * The unique { homeworkId, studentId } index is the one-submission rule, held
 * where two requests arriving together cannot both pass it.
 */
export interface IHomeworkAnswer {
  questionId: mongoose.Types.ObjectId;
  selectedIndex: number; // -1 when left unanswered
  isCorrect: boolean;
}

export interface IHomeworkSubmission extends Document {
  homeworkId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  answers: IHomeworkAnswer[];
  score: number; // correct count
  total: number;
  submittedAt: Date;
  status: "assigned" | "submitted" | "late";
  createdAt: Date;
  updatedAt: Date;
}

const homeworkSubmissionSchema = new Schema<IHomeworkSubmission>(
  {
    homeworkId: { type: Schema.Types.ObjectId, ref: "Homework", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    answers: {
      type: [
        {
          _id: false,
          questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
          selectedIndex: { type: Number, default: -1 },
          isCorrect: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["assigned", "submitted", "late"], default: "assigned" },
  },
  { timestamps: true }
);

// One submission per student per assignment.
homeworkSubmissionSchema.index({ homeworkId: 1, studentId: 1 }, { unique: true });

export const HomeworkSubmission = mongoose.model<IHomeworkSubmission>(
  "HomeworkSubmission",
  homeworkSubmissionSchema
);
