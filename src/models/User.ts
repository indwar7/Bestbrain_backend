import mongoose, { Schema, Document } from "mongoose";

// Progress shape mirrors the frontend `edutok_state` localStorage object.
export interface IProgress {
  lang: string;
  minutes: number;
  streak: number;
  badges: string[];
  chapters: Record<string, unknown>;
  pal: Record<string, unknown>;
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: "student" | "parent" | "teacher";

  // Student-facing profile fields shown on dashboards.
  classLabel?: string; // e.g. "Class 7 · CBSE"
  progress: IProgress;

  // Relationships
  childIds: mongoose.Types.ObjectId[]; // parent → their children (students)
  classIds: string[]; // teacher → classes they teach, e.g. ["Class 7", "Class 8"]

  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["student", "parent", "teacher"],
      default: "student",
    },
    classLabel: { type: String, default: "" },
    progress: {
      lang: { type: String, default: "en" },
      minutes: { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      badges: { type: [String], default: [] },
      chapters: { type: Schema.Types.Mixed, default: {} },
      pal: { type: Schema.Types.Mixed, default: {} },
    },
    childIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
    classIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);
