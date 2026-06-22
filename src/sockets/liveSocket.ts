import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { env } from "../config/env";
import { verifyAccessToken, JwtPayload } from "../utils/token";
import { User } from "../models/User";
import { LiveSession } from "../models/LiveSession";
import { canJoinSession } from "../services/liveEligibility";

interface AuthedSocket extends Socket {
  user?: JwtPayload;
}

// Room name for a given live session.
const room = (sessionId: string) => `session:${sessionId}`;

// The live Socket.IO server instance, exposed so REST controllers (e.g. ending
// a session) can broadcast into live rooms without holding their own reference.
let ioRef: Server | null = null;

// Live presence per session: sessionId → Map(userId → {name, role}).
// Used to build the roster ("who's joined") and to send a newcomer the
// current room state. Cleared per-user on disconnect/leave.
type Presence = { name: string; role: string };
const presence = new Map<string, Map<string, Presence>>();

function roomPresence(sessionId: string): Map<string, Presence> {
  let m = presence.get(sessionId);
  if (!m) {
    m = new Map();
    presence.set(sessionId, m);
  }
  return m;
}

// The set of user IDs currently present in a session — used by the roster
// endpoint to tick who has joined.
export function getPresentUserIds(sessionId: string): string[] {
  const m = presence.get(sessionId);
  return m ? Array.from(m.keys()) : [];
}

export function getIO(): Server | null {
  return ioRef;
}

// Emit `session-ended` to everyone in a session's room and force-leave them.
// Safe no-op if the socket server isn't initialised (e.g. in tests).
export function endSessionRoom(sessionId: string, by: string): void {
  if (!ioRef) return;
  const r = room(sessionId);
  ioRef.to(r).emit("session-ended", { by });
  ioRef.in(r).socketsLeave(r);
  presence.delete(sessionId); // clear roster state for the ended session
}

export function initLiveSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });
  ioRef = io;

  // Authenticate every socket via the access token on the handshake.
  io.use((socket: AuthedSocket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization || "").replace("Bearer ", "");
    if (!token) return next(new Error("Missing auth token"));
    try {
      socket.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    const user = socket.user!;
    // Track which session this socket joined so disconnect can clean up.
    let joinedSession: string | null = null;
    let displayName = user.email;

    // join-session: a participant enters a live class room.
    // Eligibility is enforced against class+section+subject before joining.
    socket.on("join-session", async ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      try {
        const [dbUser, session] = await Promise.all([
          User.findById(user.id),
          LiveSession.findById(sessionId),
        ]);
        if (!dbUser || !session) {
          socket.emit("join-denied", { reason: "Session not found" });
          return;
        }
        const verdict = canJoinSession(dbUser, session);
        if (!verdict.allowed) {
          socket.emit("join-denied", { reason: verdict.reason });
          return;
        }

        displayName = dbUser.name || user.email;
        socket.join(room(sessionId));
        joinedSession = sessionId;

        // Record presence and send the newcomer the CURRENT roster so a
        // teacher who joins late still sees everyone already in the room.
        const here = roomPresence(sessionId);
        here.set(user.id, { name: displayName, role: user.role });
        socket.emit("join-ok", { sessionId });
        socket.emit("roster", {
          present: Array.from(here.entries()).map(([userId, p]) => ({
            userId,
            name: p.name,
            role: p.role,
          })),
        });

        // Tell everyone else who just arrived (now WITH the name).
        socket.to(room(sessionId)).emit("participant-joined", {
          userId: user.id,
          name: displayName,
          role: user.role,
        });
      } catch {
        socket.emit("join-denied", { reason: "Could not join session" });
      }
    });

    // chat-message: relay a message to the whole room. An optional tagUserId
    // marks a student the teacher is calling on.
    socket.on(
      "chat-message",
      ({
        sessionId,
        text,
        tagUserId,
        tagName,
      }: {
        sessionId: string;
        text: string;
        tagUserId?: string;
        tagName?: string;
      }) => {
        if (!sessionId || !text || !text.trim()) return;
        if (joinedSession !== sessionId) return; // must be in the room
        const payload = {
          userId: user.id,
          name: displayName,
          role: user.role,
          text: String(text).slice(0, 1000),
          tagUserId: tagUserId || null,
          tagName: tagName || null,
          at: new Date().toISOString(),
        };
        // Send to everyone in the room (including sender, for a single render path).
        ioRef?.to(room(sessionId)).emit("chat-message", payload);

        // If a student was tagged, fire a "called-on" prompt to that student.
        if (tagUserId && user.role === "teacher") {
          ioRef?.to(room(sessionId)).emit("called-on", {
            tagUserId,
            byName: displayName,
            text: payload.text,
            at: payload.at,
          });
        }
      }
    );

    // leave-session: explicit leave.
    socket.on("leave-session", ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      socket.leave(room(sessionId));
      roomPresence(sessionId).delete(user.id);
      joinedSession = null;
      socket.to(room(sessionId)).emit("participant-left", { userId: user.id });
    });

    // attention-ping: student client reports webcam attention score.
    socket.on(
      "attention-ping",
      ({ sessionId, score }: { sessionId: string; score: number }) => {
        if (!sessionId) return;
        // Broadcast to the teacher(s) in the room.
        socket.to(room(sessionId)).emit("attention-update", {
          userId: user.id,
          score,
          at: new Date().toISOString(),
        });
      }
    );

    // end-session: only a teacher can end the class for everyone.
    // This is a fast signaling shortcut; the authoritative teardown (DB status
    // + LiveKit room delete) is POST /api/live/:id/end, which calls the same
    // broadcast helper. Both paths emit `session-ended` identically.
    socket.on("end-session", ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      if (user.role !== "teacher") {
        socket.emit("error-message", { error: "Only a teacher can end the session" });
        return;
      }
      endSessionRoom(sessionId, user.id);
    });

    socket.on("disconnect", () => {
      // Remove from presence and tell the room they left (socket.io itself
      // auto-leaves the room; we only need to update the roster + broadcast).
      if (joinedSession) {
        roomPresence(joinedSession).delete(user.id);
        socket.to(room(joinedSession)).emit("participant-left", {
          userId: user.id,
        });
      }
    });
  });

  return io;
}
