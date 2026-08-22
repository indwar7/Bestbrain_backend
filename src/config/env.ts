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
  /* 15 minutes was the default, and the refresh that was meant to cover it
     cannot run on the current deployment: the refresh cookie is SameSite=None,
     which a browser only stores with Secure, which it only honours over HTTPS.
     Until the site and the API are both on TLS there is no refresh at all — so
     a 15-minute access token means a student is signed out in the middle of a
     chapter the product itself calls "about 24 minutes".
     Restore a short TTL the moment TLS lands and the cookie survives. */
  accessTtl: process.env.ACCESS_TTL ?? "12h",
  refreshTtl: process.env.REFRESH_TTL ?? "7d",
  refreshCookieName: "edulearn_refresh",

  // Optional LLM key for PAL chat (falls back to a stub reply if unset).
  groqApiKey: process.env.GROQ_API_KEY ?? "",

  // Vertex AI (Gemini) — powers PAL chat. Supply the service-account credentials
  // EITHER as a file path (GOOGLE_APPLICATION_CREDENTIALS, good for local dev)
  // OR as the raw JSON string (GOOGLE_CREDENTIALS_JSON, good for hosts with no
  // persistent filesystem like Render/Railway). If neither is set, PAL falls
  // back to a stub reply.
  vertexProject: process.env.VERTEX_PROJECT ?? "",
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

  // ---- OTP / verification ----
  // When true, unverified users cannot log in. Currently disabled per product
  // decision: login is plain email + password, no email/phone verification.
  // Set OTP_ENFORCED=true in the env to re-enable the gate (endpoints still work).
  // A getter (not a snapshot) so per-suite test overrides are picked up live.
  get otpEnforced(): boolean {
    return (process.env.OTP_ENFORCED ?? "false").toLowerCase() === "true";
  },

  // Email provider: "resend" | "sendgrid" | "" (console fallback).
  emailProvider: (process.env.EMAIL_PROVIDER ?? "").toLowerCase(),
  emailFrom: process.env.EMAIL_FROM ?? "BestBrain <onboarding@resend.dev>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",

  // SMS provider: "msg91" | "twilio" | "" (console fallback).
  smsProvider: (process.env.SMS_PROVIDER ?? "").toLowerCase(),
  msg91AuthKey: process.env.MSG91_AUTH_KEY ?? "",
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID ?? "",
  msg91Sender: process.env.MSG91_SENDER ?? "EDULRN",
  twilioSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioFrom: process.env.TWILIO_FROM ?? "",

  // ---- Razorpay (BestBrain Plus subscription) ----
  // The subscription button is a *hosted* widget: Razorpay renders it, takes
  // the payment, and tells us what happened over a webhook. So the only secret
  // this server strictly needs is the webhook secret — without it we cannot
  // verify that a webhook actually came from Razorpay, and an unverified
  // webhook is an open endpoint that would let anyone grant themselves a
  // subscription. `razorpayWebhookConfigured` is checked before any event is
  // applied; when false the endpoint rejects everything rather than trusting it.
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  // Key id/secret are only needed if we later create subscriptions from the
  // server (see RAZORPAY-SETUP.md — "linking a payment to an account").
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  // The hosted button to render on /pricing. Served to the frontend by
  // GET /api/subscription/config so the id is not hard-coded in the bundle.
  razorpaySubscriptionButtonId:
    process.env.RAZORPAY_SUBSCRIPTION_BUTTON_ID ?? "pl_TSKoRXpZy9rgRy",
  // Display price, in paise. ₹900 = 90000 — matches the amount actually
  // configured on the pl_TSKoRXpZy9rgRy Razorpay plan (verified against
  // Razorpay's own API, not assumed). Razorpay's plan is still the source of
  // truth for what is actually charged; this only drives the pricing copy.
  subscriptionPricePaise: Number(process.env.SUBSCRIPTION_PRICE_PAISE ?? 90000),
  subscriptionCurrency: process.env.SUBSCRIPTION_CURRENCY ?? "INR",
  get razorpayWebhookConfigured(): boolean {
    return !!this.razorpayWebhookSecret;
  },

  // Error tracking (optional). When set, wire @sentry/node in index.ts (see
  // config/logger.ts). Unset → errors are structured-logged only.
  sentryDsn: process.env.SENTRY_DSN ?? "",

  // Allowed CORS origins, split into an array.
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:8000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  get isProd() {
    return this.nodeEnv === "production";
  },
};

// FATAL config check — refuse to boot in production with a configuration that
// is actively insecure or data-losing. These are not warnings: running with
// dev JWT secrets lets anyone forge tokens, and an in-memory DB silently loses
// every user on restart. Called once on startup, before the server listens.
export function assertProductionConfig(): void {
  if (!env.isProd) return;

  const fatal: string[] = [];

  if (env.accessSecret === DEV_ACCESS_SECRET || env.refreshSecret === DEV_REFRESH_SECRET) {
    fatal.push("JWT secrets are still the dev defaults — set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (anyone can forge tokens otherwise).");
  }
  if (!env.mongoUri || env.useMemoryDb) {
    fatal.push("No persistent database — set MONGODB_URI (in-memory data is lost on every restart).");
  }

  if (fatal.length > 0) {
    console.error("\n🛑 FATAL: refusing to start in production with insecure config:");
    for (const p of fatal) console.error(`   - ${p}`);
    console.error("");
    throw new Error("Insecure production configuration — see the errors above.");
  }
}

// Loud, non-fatal warnings for config that is incomplete but not dangerous
// (a deploy is never blocked; the operator just sees what to fix).
export function warnInsecureConfig(): void {
  if (!env.isProd) return;

  const problems: string[] = [];

  if (!env.vertexConfigured) {
    problems.push("PAL has no credentials — set GOOGLE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS); PAL will return stub replies.");
  }

  if (!env.razorpayWebhookConfigured) {
    problems.push(
      "RAZORPAY_WEBHOOK_SECRET is unset — the subscription webhook rejects every event, so paid subscriptions will never activate an account. See RAZORPAY-SETUP.md."
    );
  }

  if (problems.length > 0) {
    console.warn("\n⚠️  INCOMPLETE PRODUCTION CONFIG:");
    for (const p of problems) console.warn(`   - ${p}`);
    console.warn("");
  }
}
