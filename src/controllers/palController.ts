import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { ChatSession } from "../models/ChatSession";
import { generatePalReply } from "../services/palService";
import { buildPalContext } from "../services/palContext";

// POST /api/pal/chat
// Body: { message, sessionId? }
// - The PAL persona is derived from the authenticated user's own role, so a
//   student can't pose as a teacher. (A `role` in the body is ignored.)
// - sessionId omitted → starts a new session.
// - The server is the source of truth and persists messages.
export async function chat(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const role = req.user!.role; // trust the account, not the request body
    const { message, sessionId } = req.body as {
      message: string;
      sessionId?: string;
    };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // Load existing session (scoped to this user) or create a new one.
    let session = sessionId
      ? await ChatSession.findOne({ _id: sessionId, userId })
      : null;
    if (!session) {
      session = await ChatSession.create({ userId, palRole: role, messages: [] });
    }

    // Ground PAL in the user's REAL EduLearn data (own progress for a student,
    // child's for a parent, class snapshot for a teacher). Best-effort: if it
    // fails, PAL still answers without the data rather than erroring.
    let context = "";
    try {
      context = await buildPalContext(userId, role);
    } catch (ctxErr) {
      console.error("pal context build failed:", ctxErr);
    }

    const reply = await generatePalReply(role, session.messages, message, context);

    // Persist both turns so context survives across requests.
    session.messages.push({ role: "user", content: message, at: new Date() });
    session.messages.push({ role: "assistant", content: reply, at: new Date() });
    await session.save();

    res.json({ sessionId: session.id, reply });
  } catch (err) {
    console.error("pal chat error:", err);
    res.status(500).json({ error: "PAL is unavailable right now" });
  }
}

// GET /api/pal/sessions/:id — fetch full history for a session.
export async function getSession(req: AuthRequest, res: Response): Promise<void> {
  const session = await ChatSession.findOne({
    _id: req.params.id,
    userId: req.user!.id,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
}
