import { Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/token";
import { AuthRequest } from "./auth";

// Same as requireAuth, but also accepts the access token via ?token= for
// routes loaded by elements that can't set request headers (<video src>,
// <img src>). Only use this on read-only media endpoints, never on routes
// that mutate data, since query strings end up in server/proxy access logs.
export function requireAuthViaQueryToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;
  const token = bearer ?? (typeof req.query.token === "string" ? req.query.token : null);

  if (!token) {
    res.status(401).json({ error: "Missing or invalid access token" });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
