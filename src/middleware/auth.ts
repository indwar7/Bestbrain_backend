import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/token";

// Extend Express Request to carry the authenticated user.
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Guards routes by requiring a valid access token in the Authorization header.
export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.split(" ")[1];

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
