import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  id: string;
  email: string;
  role: "student" | "parent" | "teacher";
}

// Short-lived token sent in the Authorization header.
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessTtl } as jwt.SignOptions);
}

// Long-lived token stored in an httpOnly cookie.
export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.refreshSecret, { expiresIn: env.refreshTtl } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.accessSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.refreshSecret) as JwtPayload;
}
