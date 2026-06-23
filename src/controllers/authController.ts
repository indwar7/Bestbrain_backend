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

// ---------- helpers ----------
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

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: "student",
      rollNumber,
      className,
      section,
      board: board ?? "",
      subjects: Array.isArray(subjects) ? subjects : [],
      classLabel: `${className} · ${section}`,
    });

    const accessToken = issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
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
          className,
          section,
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

    // Verify the child: roll number must exist AND name + class must match.
    const child = await User.findOne({
      role: "student",
      rollNumber: childRollNumber,
    });
    if (!child) {
      res.status(404).json({ error: "No student found with that roll number" });
      return;
    }
    const nameMatches =
      child.name.trim().toLowerCase() === String(childName).trim().toLowerCase();
    const classMatches =
      child.className?.trim().toLowerCase() ===
      String(childClass).trim().toLowerCase();
    if (!nameMatches || !classMatches) {
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
    console.error("parent signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
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

    // Verification gate (only enforced when OTP_ENFORCED=true). Returns 403 with
    // a machine-readable code so the frontend can route to the verify screen.
    if (env.otpEnforced && !isUserVerified(user)) {
      res.status(403).json({
        error: "Please verify your account to continue.",
        code: "VERIFICATION_REQUIRED",
        userId: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
      });
      return;
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
