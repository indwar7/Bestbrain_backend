import { Response } from "express";
import { User } from "../models/User";
import { AuthRequest } from "../middleware/auth";
import { getProgressInsights } from "../services/progressInsights";

// GET /api/users/me , current user profile
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("-password");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user });
}

// GET /api/users/me/progress , replaces frontend localStorage `edutok_state`
export async function getProgress(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("progress");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // The stored `streak` is a client-reported counter; the dashboard shows the
  // real one computed from events. Send that too so every chip agrees.
  const insights = await getProgressInsights(String(user._id), new Date());
  const progress = user.toObject({ minimize: false, flattenMaps: true }).progress;
  res.json({ progress: { ...progress, dayStreak: insights.dayStreak } });
}

// Only these progress fields may be written by the client. Everything else in
// the body is ignored so a user can't inject arbitrary keys or overwrite
// server-managed state. (streak/minutes/badges are validated below.)
const WRITABLE_PROGRESS_FIELDS = ["lang", "minutes", "streak", "badges", "chapters", "pal"];

// PUT /api/users/me/progress , save (whitelisted, validated) progress fields.
export async function saveProgress(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const next = { ...user.progress } as Record<string, unknown>;

  for (const key of WRITABLE_PROGRESS_FIELDS) {
    if (body[key] === undefined) continue;
    const val = body[key];
    // Type-guard each field so junk/malicious values can't corrupt progress.
    if (key === "lang" && typeof val === "string") next.lang = val;
    else if ((key === "minutes" || key === "streak") && typeof val === "number" && val >= 0) {
      next[key] = val;
    } else if (key === "badges" && Array.isArray(val)) {
      next.badges = val.filter((b) => typeof b === "string");
    } else if ((key === "chapters" || key === "pal") && val && typeof val === "object") {
      next[key] = val;
    }
  }

  user.progress = next as unknown as typeof user.progress;
  user.markModified("progress");
  await user.save();

  res.json({ progress: user.progress });
}

// Editable profile fields per role (everything else is ignored for safety).
const EDITABLE_BY_ROLE: Record<string, string[]> = {
  student: ["name", "className", "section", "board"],
  teacher: ["name"],
  parent: ["name"],
};

// PUT /api/users/me/profile, update own profile + preferences (role-aware).
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
