import express, { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { captureException } from "./config/logger";
import { requestLogger } from "./middleware/logger";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import progressRoutes from "./routes/progressRoutes";
import coinRoutes from "./routes/coinRoutes";
import palRoutes from "./routes/palRoutes";
import liveRoutes from "./routes/liveRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import adminRoutes from "./routes/adminRoutes";
import videoRoutes from "./routes/videoRoutes";
import noteRoutes from "./routes/noteRoutes";
import curriculumRoutes from "./routes/curriculumRoutes";
import assessmentRoutes from "./routes/assessmentRoutes";
import homeworkRoutes from "./routes/homeworkRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";

export const app = express();

// Behind a reverse proxy (CloudFront/nginx) — trust it so req.ip is the real
// client IP (rate limiting keys off it) and secure cookies work over the proxy.
app.set("trust proxy", 1);

// Security headers (HSTS, no-sniff, frame options, etc.). crossOriginResourcePolicy
// is relaxed so the video <src> endpoint can still be embedded cross-origin.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Gzip responses — but never SSE streams (compression buffers them and breaks
// PAL's token-by-token streaming). Skip when the response is an event stream.
app.use(
  compression({
    filter(req, res) {
      const type = res.getHeader("Content-Type");
      if (typeof type === "string" && type.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  })
);

// CORS: allow the configured origins, plus any localhost port and file:// (null)
// origin in development so the demo works however the frontend is opened.
//
// The !isProd branch is DELIBERATE and must stay: in production only the
// explicit CLIENT_ORIGIN list is honoured. Do not add localhost entries to the
// production allowlist to make local development easier — with
// credentials:'include' on the client, any page served from that port on any
// machine could then call this API as a signed-in user and read real student
// records. To develop against production data, serve the frontend from an
// origin that is ALREADY on the list.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Rejections were previously silent: the browser reported an opaque "Failed to
// fetch" and the server logged nothing at all, so a blocked origin was
// indistinguishable from a dead server. Log each distinct rejected origin once.
const rejectedOrigins = new Set<string>();

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // file:// or same-origin/curl
      if (env.clientOrigins.includes(origin)) return cb(null, true);
      if (!env.isProd && LOCALHOST_ORIGIN.test(origin)) return cb(null, true);

      if (!rejectedOrigins.has(origin)) {
        rejectedOrigins.add(origin);
        // eslint-disable-next-line no-console
        console.warn(
          `[cors] BLOCKED origin ${origin}. Allowed: ${env.clientOrigins.join(", ") || "(none)"}` +
            (env.isProd
              ? ". Production only honours CLIENT_ORIGIN — serve the frontend from one of those origins."
              : ". Any localhost port is allowed in development.")
        );
      }
      return cb(null, false);
    },
    credentials: true,
  })
);

// Cap JSON body size — reject oversized payloads (DoS guard).
//
// `verify` stashes the exact bytes before they are parsed. The Razorpay webhook
// is signed over the raw body, and re-serialising the parsed object does not
// reproduce it (key order, unicode escaping and whitespace all differ), so the
// HMAC would never match without this. Only the webhook path is kept, because
// holding a second copy of every request body would double body memory for no
// reason.
app.use(
  express.json({
    limit: "1mb",
    verify(req, _res, buf) {
      if (req.url?.startsWith("/api/subscription/webhook")) {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use(cookieParser());
app.use(requestLogger);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "edulearn-backend" });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/coins", coinRoutes);
app.use("/api/pal", palRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/homework", homeworkRoutes);
app.use("/api/subscription", subscriptionRoutes);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — catches thrown/rejected errors so the process never
// leaks a stack trace to the client or crashes on an unhandled route error.
// (Must be last, and must keep all four args for Express to treat it as one.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  // Multer errors (oversized file, wrong mimetype) reach here as plain
  // thrown errors — surface them as a clear 4xx instead of a generic 500 so
  // the upload UI can show the real reason ("file too large" vs "server error").
  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Video is too large (max 500 MB)."
        : err.message;
    res.status(400).json({ error: message });
    return;
  }
  if (err instanceof Error && /only video files are allowed/i.test(err.message)) {
    res.status(400).json({ error: err.message });
    return;
  }

  captureException(err, { method: req.method, url: req.originalUrl });
  const payload = env.isProd
    ? { error: "Server error" }
    : { error: "Server error", detail: String((err as Error)?.message ?? err) };
  res.status(500).json(payload);
});
