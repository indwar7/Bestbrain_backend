import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { ChatSession } from "../models/ChatSession";
import { generatePalReply } from "../services/palService";

type PalRole = "student" | "parent" | "teacher";

// POST /api/pal/chat
// Body: { role, message, sessionId?, history? }
// - sessionId omitted → starts a new session.
// - history is optional; the server is the source of truth and persists messages.
export async function chat(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { role, message, sessionId } = req.body as {
      role: PalRole;
      message: string;
      sessionId?: string;
    };

    if (!role || !["student", "parent", "teacher"].includes(role)) {
      res.status(400).json({ error: "valid role is required" });
      return;
    }
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

    const reply = await generatePalReply(role, session.messages, message);

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
