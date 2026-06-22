import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

// Guards the admin endpoints, which expose user PII (names, emails, phones).
// There is no `admin` user role in the system, so access is gated by a shared
// secret supplied as `x-admin-key` (or `?adminKey=`).
//
//  - If ADMIN_API_KEY is set, the request must present a matching key.
//  - If it's unset: allowed in development (for the local DB viewer), but
//    blocked in production so PII is never publicly readable by default.
export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const provided =
    (req.headers["x-admin-key"] as string | undefined) ||
    (req.query.adminKey as string | undefined) ||
    "";

  if (env.adminApiKey) {
    if (provided === env.adminApiKey) return next();
    res.status(401).json({ error: "Invalid or missing admin key" });
    return;
  }

  // No key configured.
  if (env.isProd) {
    res.status(403).json({ error: "Admin access is not configured" });
    return;
  }
  next(); // dev convenience only
}
