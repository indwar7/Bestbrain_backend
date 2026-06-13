import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongoUri: required("MONGODB_URI"),

  // Two-token auth: short-lived access + long-lived refresh.
  accessSecret: required("JWT_ACCESS_SECRET", process.env.JWT_SECRET),
  refreshSecret: required("JWT_REFRESH_SECRET", process.env.JWT_SECRET),
  accessTtl: process.env.ACCESS_TTL ?? "15m",
  refreshTtl: process.env.REFRESH_TTL ?? "7d",
  refreshCookieName: "edulearn_refresh",

  // Optional LLM key for PAL chat (falls back to a stub reply if unset).
  groqApiKey: process.env.GROQ_API_KEY ?? "",

  // Allowed CORS origins, split into an array.
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:8000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  get isProd() {
    return this.nodeEnv === "production";
  },
};
