import { Response } from "express";
import { User } from "../models/User";
import { AuthRequest } from "../middleware/auth";

// GET /api/users/me  — current user profile
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("-password");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user });
}

// GET /api/users/me/progress  — replaces frontend localStorage `edutok_state`
export async function getProgress(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("progress");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ progress: user.progress });
}

// PUT /api/users/me/progress  — save the whole progress object
export async function saveProgress(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Merge incoming fields onto existing progress so partial updates work.
  user.progress = { ...user.progress, ...req.body };
  await user.save();

  res.json({ progress: user.progress });
}

// Editable profile fields per role (everything else is ignored for safety).
const EDITABLE_BY_ROLE: Record<string, string[]> = {
  student: ["name", "className", "section", "board"],
  teacher: ["name"],
  parent: ["name"],
};

// PUT /api/users/me/profile — update own profile + preferences (role-aware).
// Body: { name?, className?, ..., preferences?: { language, theme, emailNotifications } }
export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const allowed = EDITABLE_BY_ROLE[user.role] || ["name"];
  const updates = req.body || {};

  // Apply only whitelisted top-level fields.
  for (const key of allowed) {
    if (updates[key] !== undefined && typeof updates[key] === "string") {
      (user as unknown as Record<string, unknown>)[key] = updates[key];
    }
  }
  // Keep the student display label in sync.
  if (user.role === "student") {
    user.classLabel = `${user.className} · ${user.section}`;
  }

  // Merge preferences (partial update).
  if (updates.preferences && typeof updates.preferences === "object") {
    user.preferences = { ...user.preferences, ...updates.preferences };
  }

  await user.save();

  const safe = user.toObject() as unknown as Record<string, unknown>;
  delete safe.password;
  res.json({ user: safe });
}
