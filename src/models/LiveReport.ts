import mongoose, { Schema, Document } from "mongoose";

// One attention/monitoring report, written when a student leaves a live class.
// Persisted server-side so it survives a device change and is visible to the
// student's linked parent (localStorage alone can't cross users/devices).
export interface ILiveReportEvent {
  t: number; // seconds since join
  type: "ok" | "warn" | "bad";
  label: string;
}

export interface ILiveReport extends Document {
  studentId: mongoose.Types.ObjectId;
  studentName: string;
  className: string;
  topic: string; // what the class covered
  tutor: string;
  durationSec: number;
  score: number; // 0-100 attentiveness
  camUsed: boolean;
  onScreenPct: number | null; // % eyes-on-screen (camera), null if no camera
  lookAwayCount: number;
  awayCount: number; // times the tab lost focus
  chats: number; // doubts asked
  events: ILiveReportEvent[];
  createdAt: Date;
}

const liveReportSchema = new Schema<ILiveReport>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentName: { type: String, default: "" },
    className: { type: String, default: "" },
    topic: { type: String, default: "" },
    tutor: { type: String, default: "" },
    durationSec: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    camUsed: { type: Boolean, default: false },
    onScreenPct: { type: Number, default: null },
    lookAwayCount: { type: Number, default: 0 },
    awayCount: { type: Number, default: 0 },
    chats: { type: Number, default: 0 },
    events: [
      {
        _id: false,
        t: { type: Number, default: 0 },
        type: { type: String, enum: ["ok", "warn", "bad"], default: "ok" },
        label: { type: String, default: "" },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const LiveReport = mongoose.model<ILiveReport>("LiveReport", liveReportSchema);
