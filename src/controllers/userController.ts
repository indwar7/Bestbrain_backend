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
