import { Response } from "express";
import { env } from "../config/env";

// 7 days in milliseconds — keep in sync with REFRESH_TTL.
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(env.refreshCookieName, token, {
    httpOnly: true,
    secure: env.isProd, // HTTPS only in production
    sameSite: env.isProd ? "none" : "lax", // cross-site (Vercel→API) needs "none"
    maxAge: REFRESH_MAX_AGE,
    path: "/api/auth",
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.refreshCookieName, { path: "/api/auth" });
}
