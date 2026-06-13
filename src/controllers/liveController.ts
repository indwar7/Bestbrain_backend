import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { LiveSession } from "../models/LiveSession";

// POST /api/live  (teacher only) — create a live class session.
export async function createSession(req: AuthRequest, res: Response): Promise<void> {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const session = await LiveSession.create({
    title,
    teacherId: req.user!.id,
    status: "live",
    startedAt: new Date(),
  });
  res.status(201).json({ session });
}

// GET /api/live — list active sessions (any authenticated user).
export async function listSessions(_req: AuthRequest, res: Response): Promise<void> {
  const sessions = await LiveSession.find({ status: "live" })
    .sort({ startedAt: -1 })
    .populate("teacherId", "name");
  res.json({ sessions });
}

// POST /api/live/:id/end  (teacher only) — mark a session ended.
export async function endSession(req: AuthRequest, res: Response): Promise<void> {
  const session = await LiveSession.findOne({
    _id: req.params.id,
    teacherId: req.user!.id,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found or not yours" });
    return;
  }
  session.status = "ended";
  session.endedAt = new Date();
  await session.save();
  res.json({ session });
}
