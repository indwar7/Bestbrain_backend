import dotenv from "dotenv";

dotenv.config();

const isProd = (process.env.NODE_ENV ?? "development") === "production";

// Insecure dev defaults — if these are still in use in production it's a real
// vulnerability, so we flag them on boot (see warnInsecureConfig below).
const DEV_ACCESS_SECRET = "dev-access-secret-change-me";
const DEV_REFRESH_SECRET = "dev-refresh-secret-change-me";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Optional: if absent (or USE_MEMORY_DB=true), an in-memory MongoDB is used.
  mongoUri: process.env.MONGODB_URI ?? "",
  useMemoryDb: process.env.USE_MEMORY_DB === "true",

  // Two-token auth: short-lived access + long-lived refresh.
  // Dev fallbacks so the app boots with no .env; OVERRIDE these in production
  // (warnInsecureConfig() flags it if these defaults survive into prod).
  accessSecret:
    process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? DEV_ACCESS_SECRET,
  refreshSecret:
    process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET ?? DEV_REFRESH_SECRET,
  accessTtl: process.env.ACCESS_TTL ?? "15m",
  refreshTtl: process.env.REFRESH_TTL ?? "7d",
  refreshCookieName: "edulearn_refresh",

  // Optional LLM key for PAL chat (falls back to a stub reply if unset).
  groqApiKey: process.env.GROQ_API_KEY ?? "",

  // Vertex AI (Gemini) — powers PAL chat. Supply the service-account credentials
  // EITHER as a file path (GOOGLE_APPLICATION_CREDENTIALS, good for local dev)
  // OR as the raw JSON string (GOOGLE_CREDENTIALS_JSON, good for hosts with no
  // persistent filesystem like Render/Railway). If neither is set, PAL falls
  // back to a stub reply.
  vertexProject: process.env.VERTEX_PROJECT ?? "apt-momentum-449405-b4",
  vertexLocation: process.env.VERTEX_LOCATION ?? "global",
  vertexModel: process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
  googleCredentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  googleCredentialsJson: process.env.GOOGLE_CREDENTIALS_JSON ?? "",
  get vertexConfigured() {
    return !!(this.googleCredentialsFile || this.googleCredentialsJson);
  },

  // LiveKit (live video). If unset, the live-video endpoints return a clear
  // "not configured" error instead of crashing.
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  get livekitConfigured() {
    return !!(this.livekitUrl && this.livekitApiKey && this.livekitApiSecret);
  },

  // Admin API key — guards the user-listing endpoint (which exposes PII). When
  // unset, the admin endpoint is disabled in production and open only in dev.
  adminApiKey: process.env.ADMIN_API_KEY ?? "",

  // Allowed CORS origins, split into an array.
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:8000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  get isProd() {
    return this.nodeEnv === "production";
  },
};

// Loud, non-fatal warnings when production is running with insecure or missing
// secrets. Called once on startup. We warn rather than crash so a deploy is
// never blocked, but the operator sees exactly what to fix.
export function warnInsecureConfig(): void {
  if (!env.isProd) return;

  const problems: string[] = [];

  if (env.accessSecret === DEV_ACCESS_SECRET || env.refreshSecret === DEV_REFRESH_SECRET) {
    problems.push("JWT secrets are still the dev defaults — set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.");
  }
  if (!env.mongoUri || env.useMemoryDb) {
    problems.push("No persistent database — set MONGODB_URI (in-memory data is lost on restart).");
  }
  if (!env.vertexConfigured) {
    problems.push("PAL has no credentials — set GOOGLE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS); PAL will return stub replies.");
  }

  if (problems.length > 0) {
    console.warn("\n⚠️  INSECURE / INCOMPLETE PRODUCTION CONFIG:");
    for (const p of problems) console.warn(`   - ${p}`);
    console.warn("");
  }
}
