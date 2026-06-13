import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import progressRoutes from "./routes/progressRoutes";
import palRoutes from "./routes/palRoutes";
import liveRoutes from "./routes/liveRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";

export const app = express();

// Allow the EduLearn frontend (Vercel + localhost) to call this API with cookies.
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

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

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
