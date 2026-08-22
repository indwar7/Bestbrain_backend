import mongoose, { Schema, Document } from "mongoose";

// Progress shape mirrors the frontend `edutok_state` localStorage object.
export interface IProgress {
  lang: string;
  minutes: number;
  streak: number;
  badges: string[];
  chapters: Record<string, unknown>;
  pal: Record<string, unknown>;
  // Spendable balance. The running total lives here so a screen can render it
  // in one read; CoinLedger holds the entry behind every change, so the
  // balance can always be explained and re-derived. Coins are only ever
  // awarded by the server, from events it has already accepted — a client
  // cannot ask to be given any.
  coins: number;
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

  // ---------- Subscription (BestBrain Plus) ----------
  // Denormalised snapshot of this user's Razorpay subscription. The Subscription
  // collection is the record of truth — this exists so a request that already
  // loads the user can answer "is this account paid?" without a second query.
  // Written only by subscriptionService.syncUserSnapshot().
  subscription: {
    status: string; // Razorpay status, or "none" when never subscribed
    active: boolean; // derived: status + paidThrough, evaluated at write time
    paidThrough: Date | null; // access lasts until this instant
    razorpaySubscriptionId: string;
    updatedAt: Date | null;
  };

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
    // unique+sparse: enforce roll-number uniqueness at the DB level (not just a
    // controller pre-check, which races). sparse so non-students (no rollNumber)
    // aren't caught by the unique constraint.
    rollNumber: { type: String, unique: true, sparse: true },
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
      // min:0 is a backstop: spending checks the balance first, and this makes
      // a negative balance unwritable even if some future path forgets to.
      coins: { type: Number, default: 0, min: 0 },
    },

    // TEACHER
    teacherId: { type: String, unique: true, sparse: true },
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

    // SUBSCRIPTION (all roles) — see the interface above.
    // `active` is a stored derivation, not a live one: it is correct as of
    // `paidThrough`, so any read that cares about expiry must compare
    // paidThrough against now rather than trusting this flag alone. The
    // requireSubscription middleware does exactly that.
    subscription: {
      status: { type: String, default: "none" },
      active: { type: Boolean, default: false },
      paidThrough: { type: Date, default: null },
      razorpaySubscriptionId: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
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
