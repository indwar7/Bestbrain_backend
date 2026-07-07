import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  JwtPayload,
} from "../utils/token";
import { setRefreshCookie, clearRefreshCookie } from "../utils/cookies";
import { env } from "../config/env";
import { AuthRequest } from "../middleware/auth";
import { isUserVerified } from "../services/otpService";
import { OtpCode } from "../models/OtpCode";

// ---------- helpers ----------
// Turn a Mongo duplicate-key error (E11000) into a friendly 409. This closes
// the signup race: two concurrent requests both pass the findOne pre-check, but
// the unique index rejects the second insert — we translate that here instead
// of returning a 500. Returns true if it handled the error.
function handleDuplicateKey(err: unknown, res: Response): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return false;
  const field = e.keyPattern ? Object.keys(e.keyPattern)[0] : "";
  const messages: Record<string, string> = {
    email: "Email already registered",
    rollNumber: "This roll number is already registered",
    teacherId: "This teacher ID is already registered",
  };
  res.status(409).json({ error: messages[field] ?? "Already registered" });
  return true;
}

function issueTokens(res: Response, payload: JwtPayload): string {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// Role-specific public view of a user (only the fields that role's dashboard needs).
function publicUser(user: IUser) {
  const base = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
  };
  if (user.role === "student") {
    return {
      ...base,
      rollNumber: user.rollNumber,
      className: user.className,
      section: user.section,
      board: user.board,
      classLabel: user.classLabel,
    };
  }
  if (user.role === "teacher") {
    return { ...base, teacherId: user.teacherId, teaches: user.teaches };
  }
  // parent
  return { ...base, children: user.childLinks };
}

async function emailTaken(email: string): Promise<boolean> {
  return !!(await User.findOne({ email: email.toLowerCase() }));
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

// Roll number is meant to be globally unique (see the User schema), but a
// parent's link is only ever as correct as the roll number they typed — so
// name + class are checked too as a guard against a fat-fingered roll number
// that happens to belong to a different student.
async function findMatchingChild(
  rollNumber: string,
  name: string,
  className: string
): Promise<IUser | null> {
  const candidates = await User.find({ role: "student", rollNumber });
  return (
    candidates.find(
      (c) => norm(c.name) === norm(name) && norm(c.className) === norm(className)
    ) ?? null
  );
}

// =====================================================================
// STUDENT SIGNUP
// Body: { name, email, password, rollNumber, className, section, board?, subjects? }
// =====================================================================
export async function signupStudent(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, phone, password, rollNumber, className, section, board, subjects } =
      req.body;

    if (!name || !email || !phone || !password || !rollNumber || !className || !section) {
      res.status(400).json({
        error:
          "name, email, phone, password, rollNumber, className and section are required",
      });
      return;
    }
    if (await emailTaken(email)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    if (await User.findOne({ rollNumber })) {
      res.status(409).json({ error: "This roll number is already registered" });
      return;
    }

    // Trim so a stray space typed at signup ("Class 7 " vs "Class 7") can't
    // silently break the exact-match roster lookup a teacher relies on later.
    const cleanClassName = String(className).trim();
    const cleanSection = String(section).trim();

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: "student",
      rollNumber,
      className: cleanClassName,
      section: cleanSection,
      board: board ?? "",
      subjects: Array.isArray(subjects) ? subjects : [],
      classLabel: `${cleanClassName} · ${cleanSection}`,
    });

    const accessToken = issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
    if (handleDuplicateKey(err, res)) return;
    console.error("student signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// =====================================================================
// TEACHER SIGNUP
// Body: { name, email, password, teacherId, className, section, subject }
// =====================================================================
export async function signupTeacher(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, phone, password, teacherId, className, section, subject } =
      req.body;

    if (!name || !email || !phone || !password || !teacherId || !className || !section) {
      res.status(400).json({
        error:
          "name, email, phone, password, teacherId, className and section are required",
      });
      return;
    }
    if (await emailTaken(email)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    if (await User.findOne({ teacherId })) {
      res.status(409).json({ error: "This teacher ID is already registered" });
      return;
    }

    // Trim so a stray space typed at signup can't silently break the exact
    // string match the roster lookup (dashboardController) relies on.
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: "teacher",
      teacherId,
      teaches: [
        {
          className: String(className).trim(),
          section: String(section).trim(),
          subject: subject ?? "General",
        },
      ],
    });

    const accessToken = issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
    if (handleDuplicateKey(err, res)) return;
    console.error("teacher signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// =====================================================================
// PARENT SIGNUP — self-register, then link to a child.
// Body: { name, email, password, childRollNumber, childName, childClass }
// The child must already exist as a student; we match rollNumber + name + class.
// =====================================================================
export async function signupParent(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, phone, password, childRollNumber, childName, childClass } =
      req.body;

    if (!name || !email || !phone || !password || !childRollNumber || !childName || !childClass) {
      res.status(400).json({
        error:
          "name, email, phone, password, childRollNumber, childName and childClass are required",
      });
      return;
    }
    if (await emailTaken(email)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    // Verify the child: roll number must exist AND name + class must match,
    // so a fat-fingered roll number can't silently link the wrong student.
    const hasRoll = !!(await User.findOne({ role: "student", rollNumber: childRollNumber }));
    if (!hasRoll) {
      res.status(404).json({ error: "No student found with that roll number" });
      return;
    }
    const child = await findMatchingChild(childRollNumber, childName, childClass);
    if (!child) {
      res.status(400).json({
        error:
          "Student details don't match. Check the name and class for this roll number.",
      });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: "parent",
      childLinks: [
        {
          studentId: child._id,
          rollNumber: childRollNumber,
          relation: "guardian",
          status: "verified",
        },
      ],
    });

    const accessToken = issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
    if (handleDuplicateKey(err, res)) return;
    console.error("parent signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// =====================================================================
// RELINK CHILD (self-service fix for a mismatched parent-child link)
// Body: { childRollNumber, childName, childClass }
// Replaces the parent's existing childLinks with a freshly re-verified
// match. Needed because a bad link created before name+class checking
// existed (or from a typo) had no way to be corrected short of a new signup.
// =====================================================================
export async function relinkChild(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "parent") {
    res.status(403).json({ error: "Only parents can link a child" });
    return;
  }

  const { childRollNumber, childName, childClass } = req.body as {
    childRollNumber?: string;
    childName?: string;
    childClass?: string;
  };
  if (!childRollNumber || !childName || !childClass) {
    res.status(400).json({
      error: "childRollNumber, childName and childClass are required",
    });
    return;
  }

  const child = await findMatchingChild(childRollNumber, childName, childClass);
  if (!child) {
    res.status(400).json({
      error: "Student details don't match. Check the name and class for this roll number.",
    });
    return;
  }

  user.childLinks = [
    {
      studentId: child._id,
      rollNumber: childRollNumber,
      relation: user.childLinks[0]?.relation ?? "guardian",
      status: "verified",
    },
  ] as IUser["childLinks"];
  await user.save();

  res.json({ user: publicUser(user) });
}

// =====================================================================
// LOGIN — role-aware. Body: { email, password, role }
// The `role` is the tab the user picked; it must match their account.
// =====================================================================
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (role && role !== user.role) {
      res.status(403).json({
        error: `This account is a ${user.role}, not a ${role}. Please use the ${user.role} tab.`,
      });
      return;
    }

    // --- OTP gate ---
    // Signup verifies both email + phone. On every subsequent login we still
    // require a fresh phone OTP (like 2FA). Email is already verified from
    // signup, so the frontend shows only the phone step.
    if (env.otpEnforced) {
      // 1) Email must have been verified during signup.
      if (!user.emailVerified) {
        res.status(403).json({
          error: "Please verify your email to continue.",
          code: "VERIFICATION_REQUIRED",
          userId: user.id,
          email: user.email,
          phone: user.phone,
          emailVerified: false,
          phoneVerified: false,
        });
        return;
      }

      // 2) Require a fresh phone OTP for this login (consumed within last 5 min).
      const LOGIN_OTP_WINDOW_MS = 5 * 60 * 1000;
      const recentPhoneOtp = await OtpCode.findOne({
        userId: user._id,
        channel: "phone",
        consumedAt: { $gte: new Date(Date.now() - LOGIN_OTP_WINDOW_MS) },
      }).sort({ consumedAt: -1 });

      if (!recentPhoneOtp) {
        res.status(403).json({
          error: "Please verify your phone number to continue.",
          code: "VERIFICATION_REQUIRED",
          userId: user.id,
          email: user.email,
          phone: user.phone,
          emailVerified: true,
          phoneVerified: false,
        });
        return;
      }
    }

    const accessToken = issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.json({ accessToken, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// ---------- refresh / logout / me (unchanged behaviour) ----------
export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[env.refreshCookieName];
  if (!token) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }
  try {
    const decoded = verifyRefreshToken(token);
    const accessToken = issueTokens(res, {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    });
    res.json({ accessToken });
  } catch {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}

export async function logout(_req: Request, res: Response): Promise<void> {
  clearRefreshCookie(res);
  res.json({ message: "Logged out" });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("-password");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: publicUser(user) });
}
