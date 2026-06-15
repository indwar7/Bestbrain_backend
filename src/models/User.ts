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

// A single class a teacher is assigned to teach.
export interface ITeachingAssignment {
  className: string; // e.g. "Class 7"
  section: string; // e.g. "A"
  subject: string; // e.g. "Science"
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: "student" | "parent" | "teacher";

  // ----- Student enrollment -----
  className?: string; // e.g. "Class 7"
  section?: string; // e.g. "A"
  subjects: string[]; // subjects the student takes, e.g. ["Science", "Maths"]
  classLabel?: string; // human label e.g. "Class 7 · A" (kept for dashboards)
  progress: IProgress;

  // ----- Teacher -----
  teaches: ITeachingAssignment[]; // class+section+subject combos this teacher teaches

  // ----- Parent -----
  childIds: mongoose.Types.ObjectId[];

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

    // Student enrollment
    className: { type: String, default: "" },
    section: { type: String, default: "" },
    subjects: { type: [String], default: [] },
    classLabel: { type: String, default: "" },

    progress: {
      lang: { type: String, default: "en" },
      minutes: { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      badges: { type: [String], default: [] },
      chapters: { type: Schema.Types.Mixed, default: {} },
      pal: { type: Schema.Types.Mixed, default: {} },
    },

    // Teacher assignments
    teaches: {
      type: [
        {
          className: { type: String, required: true },
          section: { type: String, required: true },
          subject: { type: String, required: true },
        },
      ],
      default: [],
    },

    // Parent → children
    childIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);
