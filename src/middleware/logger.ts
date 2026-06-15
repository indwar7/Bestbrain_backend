import { Request, Response, NextFunction } from "express";

// Lightweight request logger — prints each API call + status so a live demo
// clearly shows registrations and logins happening on the backend.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const tag =
      res.statusCode >= 500
        ? "🔴"
        : res.statusCode >= 400
        ? "🟡"
        : "🟢";
    // e.g. "🟢 POST /api/auth/signup/student → 201 (34ms)"
    console.log(
      `${tag} ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`
    );
  });
  next();
}
