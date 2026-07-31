import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { ChatSession } from "../models/ChatSession";
import {
  generatePalReply,
  streamPalReply,
  MAX_MESSAGE_LENGTH,
} from "../services/palService";
import { buildPalContext } from "../services/palContext";

// Validate the inbound message; returns a trimmed string or null (+ writes the
// 400 response itself) so each handler can `if (!msg) return;`.
function validateMessage(req: AuthRequest, res: Response): string | null {
  const { message } = req.body as { message?: unknown };
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return null;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
    });
    return null;
  }
  return message;
}

// Load the user's session by id, or build a fresh one. Returns null (+ 404) if
// a sessionId was given but doesn't belong to this user.
//
// A NEW session is built in memory and deliberately NOT saved here: if the LLM
// call then fails, an empty session would be left behind, and since every retry
// starts another one the session list fills up with "New chat" rows holding no
// messages. Mongoose assigns the _id up front, so the id is still available;
// the caller persists it along with the first exchange.
async function loadOrCreateSession(
  req: AuthRequest,
  res: Response,
  role: "student" | "parent" | "teacher"
) {
  const userId = req.user!.id;
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) {
    const existing = await ChatSession.findOne({ _id: sessionId, userId });
    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return null;
    }
    return existing;
  }
  return new ChatSession({ userId, palRole: role, messages: [] });
}

// Credential/config failures (dead service account, missing project, malformed
// key JSON) are permanent until an operator acts — they are not the transient
// "try again in a moment" the generic message promises. Separate them so the
// user isn't told to retry something that can never succeed, and so the reason
// is visible without shell access to the server.
function isConfigFailure(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /invalid_grant|invalid_client|unauthorized_client|could not load the default credentials|permission denied|PERMISSION_DENIED|API has not been used|billing|project is required|Unable to detect a Project/i.test(
    msg
  );
}

function failChat(res: Response, err: unknown, where: string): void {
  console.error(`pal ${where} error:`, err);
  if (isConfigFailure(err)) {
    res.status(503).json({
      error: "PAL is not set up correctly on the server — please contact support.",
      code: "pal_not_configured",
    });
    return;
  }
  res.status(500).json({ error: "PAL is unavailable right now" });
}

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

    const message = validateMessage(req, res);
    if (!message) return;

    const session = await loadOrCreateSession(req, res, role);
    if (!session) return;

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
    failChat(res, err, "chat");
  }
}

// POST /api/pal/chat/stream  (Server-Sent Events)
// Same body as /chat. Streams the reply as it's generated:
//   event: chunk  data: {"text":"..."}   (repeated)
//   event: done   data: {"sessionId":"..."}
//   event: error  data: {"error":"..."}
export async function chatStream(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const role = req.user!.role;

  const message = validateMessage(req, res);
  if (!message) return;

  const session = await loadOrCreateSession(req, res, role);
  if (!session) return;

  // Open the SSE stream.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let context = "";
  try {
    context = await buildPalContext(userId, role);
  } catch (ctxErr) {
    console.error("pal context build failed:", ctxErr);
  }

  let full = "";
  try {
    for await (const piece of streamPalReply(role, session.messages, message, context)) {
      full += piece;
      send("chunk", { text: piece });
    }

    // Persist the completed exchange.
    session.messages.push({ role: "user", content: message, at: new Date() });
    session.messages.push({
      role: "assistant",
      content: full || "(no reply)",
      at: new Date(),
    });
    await session.save();

    send("done", { sessionId: session.id });
  } catch (err) {
    console.error("pal stream error:", err);
    // The 200 for the SSE stream is already sent, so the status can't carry
    // this — the event does. (The session is only saved on success above, so a
    // failed stream leaves no empty session behind.)
    send("error", {
      error: isConfigFailure(err)
        ? "PAL is not set up correctly on the server — please contact support."
        : "PAL is unavailable right now",
      code: isConfigFailure(err) ? "pal_not_configured" : "pal_unavailable",
    });
  } finally {
    res.end();
  }
}

// GET /api/pal/sessions — list the current user's sessions (newest first,
// without the full message bodies). Includes a short preview + counts.
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const sessions = await ChatSession.find({ userId: req.user!.id })
    .sort({ updatedAt: -1 })
    .select("palRole title messages updatedAt createdAt")
    .lean();

  const summaries = sessions.map((s) => {
    const msgs = s.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    return {
      id: String(s._id),
      palRole: s.palRole,
      title: s.title || lastUser?.content?.slice(0, 60) || "New chat",
      messageCount: msgs.length,
      lastMessageAt: msgs.length ? msgs[msgs.length - 1].at : s.updatedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  res.json({ sessions: summaries });
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

// PATCH /api/pal/sessions/:id — rename a session. Body: { title }
export async function renameSession(req: AuthRequest, res: Response): Promise<void> {
  const { title } = req.body as { title?: unknown };
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const session = await ChatSession.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id },
    { title: title.trim().slice(0, 120) },
    { returnDocument: "after" }
  );
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ id: session.id, title: session.title });
}

// DELETE /api/pal/sessions/:id — delete one of the user's sessions.
export async function deleteSession(req: AuthRequest, res: Response): Promise<void> {
  const result = await ChatSession.deleteOne({
    _id: req.params.id,
    userId: req.user!.id,
  });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ deleted: true });
}
