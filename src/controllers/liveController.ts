import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { LiveSession } from "../models/LiveSession";
import { User } from "../models/User";
import { canJoinSession } from "../services/liveEligibility";

// Generate a short, readable join code, e.g. "SCI-7A-4821".
function makeJoinCode(subject: string, className: string, section: string): string {
  const subj = subject.slice(0, 3).toUpperCase();
  const cls = className.replace(/[^0-9]/g, "") || "X";
  const rand = String(Math.floor(1000 + Math.abs(hashStr(subject + className + section)) % 9000));
  return `${subj}-${cls}${section.toUpperCase()}-${rand}`;
}

// Deterministic small hash so we don't need Math.random here.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h + Date.now();
}

// POST /api/live  (teacher only) — create a targeted live class.
// Body: { title, className, section, subject }
export async function createSession(req: AuthRequest, res: Response): Promise<void> {
  const { title, className, section, subject } = req.body;
  if (!title || !className || !section || !subject) {
    res
      .status(400)
      .json({ error: "title, className, section and subject are required" });
    return;
  }

  // Verify the teacher is actually assigned to this class+section+subject.
  const teacher = await User.findById(req.user!.id);
  const teaches = teacher?.teaches?.some(
    (t) =>
      t.className === className &&
      t.section === section &&
      t.subject === subject
  );
  if (!teaches) {
    res.status(403).json({
      error: `You are not assigned to teach ${subject} for ${className} ${section}`,
    });
    return;
  }

  const session = await LiveSession.create({
    title,
    teacherId: req.user!.id,
    className,
    section,
    subject,
    joinCode: makeJoinCode(subject, className, section),
    status: "live",
    startedAt: new Date(),
  });

  res.status(201).json({ session });
}

// GET /api/live — list sessions the current user is eligible for.
//  - student → only live sessions for their class+section+subjects
//  - teacher → their own live sessions
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role === "teacher") {
    const sessions = await LiveSession.find({
      teacherId: user._id,
      status: "live",
    }).sort({ startedAt: -1 });
    res.json({ sessions });
    return;
  }

  if (user.role === "student") {
    const sessions = await LiveSession.find({
      status: "live",
      className: user.className,
      section: user.section,
      subject: { $in: user.subjects },
    })
      .sort({ startedAt: -1 })
      .populate("teacherId", "name");
    res.json({ sessions });
    return;
  }

  // Parents etc. have no live classes.
  res.json({ sessions: [] });
}

// POST /api/live/:id/join — eligibility-checked join.
// Returns the room info the frontend needs (video provider details added later).
export async function joinSession(req: AuthRequest, res: Response): Promise<void> {
  const [user, session] = await Promise.all([
    User.findById(req.user!.id),
    LiveSession.findById(req.params.id),
  ]);
  if (!user || !session) {
    res.status(404).json({ error: "User or session not found" });
    return;
  }

  const verdict = canJoinSession(user, session);
  if (!verdict.allowed) {
    res.status(403).json({ error: verdict.reason });
    return;
  }

  res.json({
    ok: true,
    session: {
      id: session.id,
      title: session.title,
      className: session.className,
      section: session.section,
      subject: session.subject,
      // Frontend uses this room name to connect Socket.IO + (later) the video SDK.
      room: `session:${session.id}`,
      videoProvider: session.videoProvider || null,
      videoRoom: session.videoRoom || null,
    },
  });
}

// POST /api/live/:id/end  (teacher only) — end the owning teacher's session.
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
