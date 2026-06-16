import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { requestLogger } from "./middleware/logger";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import progressRoutes from "./routes/progressRoutes";
import palRoutes from "./routes/palRoutes";
import liveRoutes from "./routes/liveRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import adminRoutes from "./routes/adminRoutes";
import videoRoutes from "./routes/videoRoutes";

export const app = express();

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

app.use(express.json());
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

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
