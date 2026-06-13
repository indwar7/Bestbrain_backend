import mongoose, { Schema, Document } from "mongoose";

export interface ILiveSession extends Document {
  title: string;
  teacherId: mongoose.Types.ObjectId;
  status: "scheduled" | "live" | "ended";
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

const liveSessionSchema = new Schema<ILiveSession>(
  {
    title: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const LiveSession = mongoose.model<ILiveSession>(
  "LiveSession",
  liveSessionSchema
);
