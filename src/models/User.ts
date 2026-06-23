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

// A class a teacher is assigned to teach.
export interface ITeachingAssignment {
  className: string;
  section: string;
  subject: string;
}

// A parent's link to one of their children.
export interface IChildLink {
  studentId: mongoose.Types.ObjectId;
  rollNumber: string; // the roll number the parent used to claim the child
  relation: "father" | "mother" | "guardian";
  status: "verified"; // (kept simple for v1: link is verified on a successful match)
}

export interface IUser extends Document {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: "student" | "parent" | "teacher";

  // ---------- Verification (email / phone OTP) ----------
  emailVerified: boolean;
  phoneVerified: boolean;

  // ---------- STUDENT fields ----------
  rollNumber?: string; // unique student roll number, e.g. "EDU-7A-021"
  className?: string; // e.g. "Class 7"
  section?: string; // e.g. "A"
  board?: string; // e.g. "CBSE" / "ICSE" / "State"
  subjects: string[];
  classLabel?: string; // display label, e.g. "Class 7 · A"
  progress: IProgress;

  // ---------- TEACHER fields ----------
  teacherId?: string; // unique teacher code, e.g. "TCH-104"
  teaches: ITeachingAssignment[];

  // ---------- PARENT fields ----------
  childLinks: IChildLink[];

  // ---------- Preferences (all roles) ----------
  preferences: {
    language: string; // "en" | "hi"
    theme: string; // "light" | "dark" | "system"
    emailNotifications: boolean;
    [key: string]: unknown;
  };

  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["student", "parent", "teacher"],
      required: true,
    },

    // Verification flags (set true once the matching OTP is confirmed).
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    // STUDENT
    rollNumber: { type: String, sparse: true, index: true },
    className: { type: String, default: "" },
    section: { type: String, default: "" },
    board: { type: String, default: "" },
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

    // TEACHER
    teacherId: { type: String, sparse: true, index: true },
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

    // PARENT
    childLinks: {
      type: [
        {
          studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          rollNumber: { type: String, required: true },
          relation: {
            type: String,
            enum: ["father", "mother", "guardian"],
            default: "guardian",
          },
          status: { type: String, enum: ["verified"], default: "verified" },
        },
      ],
      default: [],
    },

    // Preferences (all roles)
    preferences: {
      language: { type: String, default: "en" },
      theme: { type: String, default: "system" },
      emailNotifications: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);
