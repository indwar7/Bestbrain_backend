import mongoose, { Schema, Document } from "mongoose";

export interface ILiveSession extends Document {
  title: string;
  teacherId: mongoose.Types.ObjectId;

  // Targeting: only students in this class + section taking this subject can join.
  className: string; // e.g. "Class 7"
  section: string; // e.g. "A"
  subject: string; // e.g. "Science"

  joinCode: string; // short code students can also use to join
  status: "scheduled" | "live" | "ended";

  // Video provider details — filled in later when a SDK (LiveKit/100ms) is wired.
  // Kept provider-agnostic for now.
  videoProvider?: string; // e.g. "livekit"
  videoRoom?: string; // provider room id/name

  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

const liveSessionSchema = new Schema<ILiveSession>(
  {
    title: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    className: { type: String, required: true },
    section: { type: String, required: true },
    subject: { type: String, required: true },

    joinCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },

    videoProvider: { type: String, default: "" },
    videoRoom: { type: String, default: "" },

    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Fast lookup of live sessions targeting a given class/section.
liveSessionSchema.index({ className: 1, section: 1, status: 1 });

export const LiveSession = mongoose.model<ILiveSession>(
  "LiveSession",
  liveSessionSchema
);
