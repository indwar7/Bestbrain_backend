import mongoose, { Schema, Document } from "mongoose";

export type ProgressEventType =
  | "lesson_watched"
  | "exercise_submitted"
  | "chapter_completed"
  | "streak_tick"
  | "badge_earned";

export interface IProgressEvent extends Document {
  userId: mongoose.Types.ObjectId;
  clientEventId: string; // unique id generated on the client (for idempotency)
  type: ProgressEventType;
  payload: Record<string, unknown>;
  occurredAt: Date; // client timestamp — used for chronological merge
  createdAt: Date;
}

const progressEventSchema = new Schema<IProgressEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientEventId: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "lesson_watched",
        "exercise_submitted",
        "chapter_completed",
        "streak_tick",
        "badge_earned",
      ],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A client event is processed at most once per user → idempotent sync.
progressEventSchema.index({ userId: 1, clientEventId: 1 }, { unique: true });

export const ProgressEvent = mongoose.model<IProgressEvent>(
  "ProgressEvent",
  progressEventSchema
);
