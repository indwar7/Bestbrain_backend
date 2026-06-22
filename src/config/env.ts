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
  // Optional: if absent (or USE_MEMORY_DB=true), an in-memory MongoDB is used.
  mongoUri: process.env.MONGODB_URI ?? "",
  useMemoryDb: process.env.USE_MEMORY_DB === "true",

  // Two-token auth: short-lived access + long-lived refresh.
  // Dev fallbacks so the app boots with no .env; OVERRIDE these in production.
  accessSecret:
    process.env.JWT_ACCESS_SECRET ??
    process.env.JWT_SECRET ??
    "dev-access-secret-change-me",
  refreshSecret:
    process.env.JWT_REFRESH_SECRET ??
    process.env.JWT_SECRET ??
    "dev-refresh-secret-change-me",
  accessTtl: process.env.ACCESS_TTL ?? "15m",
  refreshTtl: process.env.REFRESH_TTL ?? "7d",
  refreshCookieName: "edulearn_refresh",

  // Optional LLM key for PAL chat (falls back to a stub reply if unset).
  groqApiKey: process.env.GROQ_API_KEY ?? "",

  // Vertex AI (Gemini) — powers PAL chat. Point GOOGLE_APPLICATION_CREDENTIALS
  // at the service-account JSON file. If unset, PAL falls back to a stub reply.
  vertexProject: process.env.VERTEX_PROJECT ?? "apt-momentum-449405-b4",
  vertexLocation: process.env.VERTEX_LOCATION ?? "global",
  vertexModel: process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
  googleCredentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  get vertexConfigured() {
    return !!this.googleCredentialsFile;
  },

  // LiveKit (live video). If unset, the live-video endpoints return a clear
  // "not configured" error instead of crashing.
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  get livekitConfigured() {
    return !!(this.livekitUrl && this.livekitApiKey && this.livekitApiSecret);
  },

  // Allowed CORS origins, split into an array.
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:8000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  get isProd() {
    return this.nodeEnv === "production";
  },
};
