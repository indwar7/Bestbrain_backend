import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

type Role = "student" | "parent" | "teacher";

// Usage: router.post("/live", requireAuth, requireRole("teacher"), handler)
// Must run AFTER requireAuth so req.user is populated.
export function requireRole(...allowed: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${allowed.join(" or ")}`,
      });
      return;
    }
    next();
  };
}
