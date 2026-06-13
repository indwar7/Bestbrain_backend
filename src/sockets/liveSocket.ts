import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { env } from "../config/env";
import { verifyAccessToken, JwtPayload } from "../utils/token";

interface AuthedSocket extends Socket {
  user?: JwtPayload;
}

// Room name for a given live session.
const room = (sessionId: string) => `session:${sessionId}`;

export function initLiveSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });

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

    // join-session: a participant enters a live class room.
    socket.on("join-session", ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      socket.join(room(sessionId));
      socket.to(room(sessionId)).emit("participant-joined", {
        userId: user.id,
        role: user.role,
      });
    });

    // leave-session: explicit leave.
    socket.on("leave-session", ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      socket.leave(room(sessionId));
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
    socket.on("end-session", ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      if (user.role !== "teacher") {
        socket.emit("error-message", { error: "Only a teacher can end the session" });
        return;
      }
      io.to(room(sessionId)).emit("session-ended", { by: user.id });
      io.in(room(sessionId)).socketsLeave(room(sessionId));
    });

    socket.on("disconnect", () => {
      // socket.io auto-leaves rooms on disconnect; nothing required here.
    });
  });

  return io;
}
