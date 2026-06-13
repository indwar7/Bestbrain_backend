import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  JwtPayload,
} from "../utils/token";
import { setRefreshCookie, clearRefreshCookie } from "../utils/cookies";
import { env } from "../config/env";
import { AuthRequest } from "../middleware/auth";

function issueTokens(res: Response, payload: JwtPayload) {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
}) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// POST /api/auth/signup
export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email and password are required" });
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role });

    const payload: JwtPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken = issueTokens(res, payload);

    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
    console.error("signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/auth/login
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const payload: JwtPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken = issueTokens(res, payload);

    res.json({ accessToken, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/auth/refresh — uses the httpOnly refresh cookie to mint a new access token.
export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[env.refreshCookieName];
  if (!token) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }

  try {
    const decoded = verifyRefreshToken(token);
    const payload: JwtPayload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    // Rotate the refresh token on every use.
    const accessToken = issueTokens(res, payload);
    res.json({ accessToken });
  } catch {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}

// POST /api/auth/logout
export async function logout(_req: Request, res: Response): Promise<void> {
  clearRefreshCookie(res);
  res.json({ message: "Logged out" });
}

// GET /api/auth/me — called on app load to hydrate the session.
export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("-password");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user });
}
