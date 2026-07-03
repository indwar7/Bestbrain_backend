import { Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { AuthRequest } from "../middleware/auth";
import { LiveSession } from "../models/LiveSession";
import { User } from "../models/User";
import { canJoinSession } from "../services/liveEligibility";
import { deleteLiveKitRoom } from "../services/liveVideo";
import { endSessionRoom, getPresentUserIds } from "../sockets/liveSocket";
import { env } from "../config/env";

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

// Shape the room info the frontend needs after a successful join. Shared by
// the by-id and by-code join paths so both return an identical payload.
function joinPayload(session: InstanceType<typeof LiveSession>) {
  return {
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
  };
}

// POST /api/live/:id/join — eligibility-checked join by session id.
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

  res.json(joinPayload(session));
}

// POST /api/live/join-by-code — join using the short join code (e.g. "SCI-7A-4821").
// Body: { code }. Same eligibility as by-id join: the code is a shortcut, not a
// security bypass — a user still must belong to the class/section/subject.
export async function joinByCode(req: AuthRequest, res: Response): Promise<void> {
  const raw = (req.body?.code ?? "") as unknown;
  const code = String(raw).trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: "A join code is required" });
    return;
  }

  const [user, session] = await Promise.all([
    User.findById(req.user!.id),
    // Codes are generated uppercase; match case-insensitively for safety.
    LiveSession.findOne({ joinCode: code }),
  ]);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!session) {
    res.status(404).json({ error: "No class found for that code" });
    return;
  }

  const verdict = canJoinSession(user, session);
  if (!verdict.allowed) {
    res.status(403).json({ error: verdict.reason });
    return;
  }

  res.json(joinPayload(session));
}

// POST /api/live/:id/token — issue a LiveKit access token for the video room.
// Eligibility is the SAME as joinSession. Teacher (owner) can publish;
// students can only subscribe (watch).
export async function getVideoToken(req: AuthRequest, res: Response): Promise<void> {
  if (!env.livekitConfigured) {
    res.status(503).json({ error: "Live video is not configured (LiveKit keys missing)" });
    return;
  }

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

  const isOwner =
    user.role === "teacher" && String(session.teacherId) === String(user._id);

  const roomName = `session-${session.id}`;
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: String(user._id),
    name: user.name,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: isOwner, // only the teacher streams
    canSubscribe: true, // everyone can watch
  });

  // Persist provider info on the session (first time).
  if (!session.videoProvider) {
    session.videoProvider = "livekit";
    session.videoRoom = roomName;
    await session.save();
  }

  res.json({
    token: await at.toJwt(),
    url: env.livekitUrl,
    room: roomName,
    role: isOwner ? "host" : "viewer",
    identity: String(user._id),
    name: user.name,
  });
}

// GET /api/live/:id/roster — the full eligible class for a session, each
// student marked present (joined) or not. Teacher (owner) only: this is the
// "who's in / who's missing" panel for the live classroom.
export async function getRoster(req: AuthRequest, res: Response): Promise<void> {
  const session = await LiveSession.findOne({
    _id: req.params.id,
    teacherId: req.user!.id,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found or not yours" });
    return;
  }

  // Every student eligible for this class+section+subject is on the roster,
  // whether or not they've joined yet.
  const students = await User.find({
    role: "student",
    className: session.className,
    section: session.section,
    subjects: session.subject,
  })
    .select("name rollNumber")
    .sort({ name: 1 });

  const present = new Set(getPresentUserIds(String(session._id)));

  const roster = students.map((s) => ({
    userId: String(s._id),
    name: s.name,
    rollNumber: s.rollNumber || "",
    present: present.has(String(s._id)),
  }));

  res.json({
    roster,
    joined: roster.filter((r) => r.present).length,
    total: roster.length,
  });
}

// POST /api/live/:id/end  (teacher only) — end the owning teacher's session.
// Full teardown: flips DB status, tears down the LiveKit room (disconnecting
// all participants server-side), and broadcasts `session-ended` over Socket.IO.
export async function endSession(req: AuthRequest, res: Response): Promise<void> {
  const session = await LiveSession.findOne({
    _id: req.params.id,
    teacherId: req.user!.id,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found or not yours" });
    return;
  }

  if (session.status === "ended") {
    res.json({ session, alreadyEnded: true });
    return;
  }

  session.status = "ended";
  session.endedAt = new Date();
  await session.save();

  // Tear down the video room so no participant can keep streaming/watching.
  // Best-effort: a LiveKit failure must not prevent the session from ending.
  let videoTornDown = false;
  if (session.videoRoom) {
    try {
      videoTornDown = await deleteLiveKitRoom(session.videoRoom);
    } catch (err) {
      console.error(`Failed to delete LiveKit room ${session.videoRoom}:`, err);
    }
  }

  // Tell everyone still in the Socket.IO room that the class is over.
  endSessionRoom(session.id, req.user!.id);

  res.json({ session, videoTornDown });
}
