import express from "express";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";

export const app = express();

// Allow the EduLearn frontend (Vercel + localhost) to call this API.
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "edulearn-backend" });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
