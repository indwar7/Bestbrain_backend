import crypto from "crypto";
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { ChatSession } from "../models/ChatSession";
import {
  generatePalReply,
  streamPalReply,
  MAX_MESSAGE_LENGTH,
} from "../services/palService";
import { buildPalContext } from "../services/palContext";
import { buildStudyDoc, checkTopic } from "../services/studyPdfService";
import { User } from "../models/User";
import { awardCoins, spendCoins } from "../services/coinService";

// Coins, see the coin-economy design notes in subscriptionService.ts
// (coinsForPayment): 3 coins is calibrated against real Gemini 2.5 Flash
// pricing to sit safely above the actual per-question cost, while still
// mapping cleanly onto the ₹1/question figure the coin budget was sized
// around. Only students are metered - PAL's parent/teacher personas were
// never part of that budget, so charging them would be pricing something
// that was never costed.
const PAL_QUESTION_COST = 3;

type PalCharge = { ok: true; refId: string | null } | { ok: false; balance: number };

async function chargePalQuestion(
  userId: string,
  role: "student" | "parent" | "teacher"
): Promise<PalCharge> {
  if (role !== "student") return { ok: true, refId: null };
  // A fresh id per attempt, not a client-supplied one - PAL has no natural
  // "message id" until after a reply exists. The cost of that: a genuine
  // client retry of a request that actually succeeded charges again. The
  // upfront-charge-then-refund-on-failure pattern below at least guarantees
  // the far more common case, the model call itself failing, never costs
  // the student anything.
  const refId = `pal:${userId}:${crypto.randomUUID()}`;
  const result = await spendCoins(userId, PAL_QUESTION_COST, "pal_question", refId);
  if (!result.spent) return { ok: false, balance: result.balance };
  return { ok: true, refId };
}

async function refundPalQuestion(userId: string, refId: string | null): Promise<void> {
  if (!refId) return;
  await awardCoins(userId, PAL_QUESTION_COST, "pal_question_refund", refId + ":refund");
}

function insufficientCoinsPayload(balance: number) {
  return {
    error: "Not enough coins for another PAL question.",
    code: "insufficient_coins",
    balance,
    cost: PAL_QUESTION_COST,
  };
}

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
  role: "student" | "parent" | "teacher",
  mode: "text" | "voice" = "text"
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
  return new ChatSession({ userId, palRole: role, messages: [], mode });
}

// Credential/config failures (dead service account, missing project, malformed
// key JSON) are permanent until an operator acts, they are not the transient
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
      error: "PAL is not set up correctly on the server, please contact support.",
      code: "pal_not_configured",
    });
    return;
  }
  res.status(500).json({ error: "PAL is unavailable right now" });
}

// The student's class picks which textbook corpus PAL retrieves from (see
// PAL_RAG_CORPORA). Parents and teachers aren't tied to one class, so none.
async function studentClass(userId: string, role: string): Promise<string> {
  if (role !== "student") return "";
  const profile = await User.findById(userId).select("className").lean();
  return profile?.className ?? "";
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

    const charge = await chargePalQuestion(userId, role);
    if (!charge.ok) {
      res.status(402).json(insufficientCoinsPayload(charge.balance));
      return;
    }

    // Ground PAL in the user's REAL BestBrain data (own progress for a student,
    // child's for a parent, class snapshot for a teacher). Best-effort: if it
    // fails, PAL still answers without the data rather than erroring.
    let context = "";
    try {
      context = await buildPalContext(userId, role);
    } catch (ctxErr) {
      console.error("pal context build failed:", ctxErr);
    }

    let reply: string;
    try {
      reply = await generatePalReply(
        role,
        session.messages,
        message,
        context,
        false,
        await studentClass(userId, role)
      );
    } catch (genErr) {
      await refundPalQuestion(userId, charge.refId);
      throw genErr;
    }

    // Persist both turns so context survives across requests.
    session.messages.push({ role: "user", content: message, at: new Date() });
    session.messages.push({ role: "assistant", content: reply, at: new Date() });
    await session.save();

    res.json({ sessionId: session.id, reply });
  } catch (err) {
    failChat(res, err, "chat");
  }
}

// Shared SSE implementation for /chat/stream and /tutor/stream. `voice: true`
// switches PAL into the spoken live-doubt-session style (short, plain,
// speakable answers) and tags new sessions mode:"voice" so the session list
// can show them as doubt calls.
async function runChatStream(
  req: AuthRequest,
  res: Response,
  voice: boolean
): Promise<void> {
  const userId = req.user!.id;
  const role = req.user!.role;

  const message = validateMessage(req, res);
  if (!message) return;

  const session = await loadOrCreateSession(req, res, role, voice ? "voice" : "text");
  if (!session) return;

  // Charged before the stream opens, not after: once writeHead below sends
  // 200 the status code can no longer carry "insufficient coins", it would
  // have to become an SSE error event instead, and a plain 402 here is
  // simpler and matches the non-streaming /chat handler.
  const charge = await chargePalQuestion(userId, role);
  if (!charge.ok) {
    res.status(402).json(insufficientCoinsPayload(charge.balance));
    return;
  }

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
    for await (const piece of streamPalReply(
      role,
      session.messages,
      message,
      context,
      voice,
      await studentClass(userId, role)
    )) {
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
    await refundPalQuestion(userId, charge.refId);
    // The 200 for the SSE stream is already sent, so the status can't carry
    // this, the event does. (The session is only saved on success above, so a
    // failed stream leaves no empty session behind.)
    send("error", {
      error: isConfigFailure(err)
        ? "PAL is not set up correctly on the server, please contact support."
        : "PAL is unavailable right now",
      code: isConfigFailure(err) ? "pal_not_configured" : "pal_unavailable",
    });
  } finally {
    res.end();
  }
}

// POST /api/pal/chat/stream  (Server-Sent Events)
// Same body as /chat. Streams the reply as it's generated:
//   event: chunk  data: {"text":"..."}   (repeated)
//   event: done   data: {"sessionId":"..."}
//   event: error  data: {"error":"..."}
export async function chatStream(req: AuthRequest, res: Response): Promise<void> {
  return runChatStream(req, res, false);
}

// POST /api/pal/tutor/stream  (Server-Sent Events)
// The live doubt session: same protocol as /chat/stream, but replies are
// voice-optimized (short, plain, speakable), the client reads them aloud.
export async function tutorStream(req: AuthRequest, res: Response): Promise<void> {
  return runChatStream(req, res, true);
}

// POST /api/pal/study-pdf, structured study material for one science topic.
//
// Returns the document as data, not as a file: the client already renders the
// app's typography and can print to PDF with the browser's own engine, which
// keeps the layout identical to what the student saw on screen and spares the
// server a PDF toolchain it would otherwise have to keep alive.
export async function studyPdf(req: AuthRequest, res: Response): Promise<void> {
  const { topic } = req.body as { topic?: unknown };
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  const verdict = checkTopic(topic);
  if (!verdict.ok) {
    res.status(400).json({ error: verdict.reason, code: "topic_rejected" });
    return;
  }

  /* The class shapes the depth of the explanation, and the token does not
     carry it, read it from the profile rather than trusting the client. */
  const profile = await User.findById(req.user!.id).select("className").lean();
  const className = profile?.className || "Class 6";
  const doc = await buildStudyDoc(topic.trim(), className);
  res.json(doc);
}

// GET /api/pal/sessions, list the current user's sessions (newest first,
// without the full message bodies). Includes a short preview + counts.
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const sessions = await ChatSession.find({ userId: req.user!.id })
    .sort({ updatedAt: -1 })
    .select("palRole mode title messages updatedAt createdAt")
    .lean();

  const summaries = sessions.map((s) => {
    const msgs = s.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    return {
      id: String(s._id),
      palRole: s.palRole,
      mode: s.mode || "text",
      title: s.title || lastUser?.content?.slice(0, 60) || "New chat",
      messageCount: msgs.length,
      lastMessageAt: msgs.length ? msgs[msgs.length - 1].at : s.updatedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  res.json({ sessions: summaries });
}

// GET /api/pal/sessions/:id, fetch full history for a session.
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

// PATCH /api/pal/sessions/:id, rename a session. Body: { title }
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

// DELETE /api/pal/sessions/:id, delete one of the user's sessions.
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
