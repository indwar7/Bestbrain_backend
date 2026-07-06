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
import palRoutes from "./routes/palRoutes";
import liveRoutes from "./routes/liveRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import adminRoutes from "./routes/adminRoutes";
import videoRoutes from "./routes/videoRoutes";
import curriculumRoutes from "./routes/curriculumRoutes";
import assessmentRoutes from "./routes/assessmentRoutes";

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
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // file:// or same-origin/curl
      if (env.clientOrigins.includes(origin)) return cb(null, true);
      if (!env.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  })
);

// Cap JSON body size — reject oversized payloads (DoS guard).
app.use(express.json({ limit: "1mb" }));
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
app.use("/api/pal", palRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/assessments", assessmentRoutes);

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
