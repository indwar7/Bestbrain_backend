import dotenv from "dotenv";

dotenv.config();

const isProd = (process.env.NODE_ENV ?? "development") === "production";

// Insecure dev defaults, if these are still in use in production it's a real
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
     Until the site and the API are both on TLS there is no refresh at all, so
     a 15-minute access token means a student is signed out in the middle of a
     chapter the product itself calls "about 24 minutes".
     Restore a short TTL the moment TLS lands and the cookie survives. */
  accessTtl: process.env.ACCESS_TTL ?? "12h",
  refreshTtl: process.env.REFRESH_TTL ?? "7d",
  // Coins every student starts with, so PAL chat, the live doubt session and
  // lecture videos can be tried from day one; more come from the Arena or a coin pack. 0 turns it off.
  welcomeCoins: Math.max(0, Math.floor(Number(process.env.WELCOME_COINS ?? 30)) || 0),
  refreshCookieName: "edulearn_refresh",

  // Optional LLM key for PAL chat (falls back to a stub reply if unset).
  groqApiKey: process.env.GROQ_API_KEY ?? "",

  // Vertex AI (Gemini), powers PAL chat. Supply the service-account credentials
  // EITHER as a file path (GOOGLE_APPLICATION_CREDENTIALS, good for local dev)
  // OR as the raw JSON string (GOOGLE_CREDENTIALS_JSON, good for hosts with no
  // persistent filesystem like Render/Railway). If neither is set, PAL falls
  // back to a stub reply.
  vertexProject: process.env.VERTEX_PROJECT ?? "",
  vertexLocation: process.env.VERTEX_LOCATION ?? "global",
  vertexModel: process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
  googleCredentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  googleCredentialsJson: process.env.GOOGLE_CREDENTIALS_JSON ?? "",
  // Vertex AI RAG Engine corpora PAL retrieves from, keyed by the student's
  // className: "Class 7=projects/p/locations/asia-south1/ragCorpora/123;Class 6=...".
  // Built with `npm run rag:ingest`. A class with no entry gets no retrieval.
  palRagCorpora: Object.fromEntries(
    (process.env.PAL_RAG_CORPORA ?? "")
      .split(";")
      .map((pair) => pair.split("=").map((s) => s.trim()))
      .filter(([cls, corpus]) => cls && corpus)
  ) as Record<string, string>,
  get vertexConfigured() {
    // Vertex needs BOTH a credential and a project id. Checking only the
    // credential let a half-configured deploy read as configured: the client
    // then built fine and the first real call failed with "Unable to detect a
    // Project", which surfaces to the student as a 503 rather than as the
    // setup mistake it is. VERTEX_PROJECT has no safe default, it names
    // someone's billing account, so it has to be set explicitly.
    return !!((this.googleCredentialsFile || this.googleCredentialsJson) && this.vertexProject);
  },

  // Why the credential is unusable, or "" when it is fine. Kept separate from
  // vertexConfigured so startup can say which half is missing instead of just
  // "PAL has no credentials", which sends people looking for the wrong thing.
  get vertexConfigProblem(): string {
    const hasCred = !!(this.googleCredentialsFile || this.googleCredentialsJson);
    if (!hasCred && !this.vertexProject) return "";
    if (!hasCred) return "VERTEX_PROJECT is set but no credential is, set GOOGLE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS).";
    if (!this.vertexProject) return "A Google credential is set but VERTEX_PROJECT is not - Vertex cannot infer the project and every PAL call will fail.";
    if (this.googleCredentialsJson) {
      let parsed: { project_id?: string; type?: string; private_key?: string };
      try {
        parsed = JSON.parse(this.googleCredentialsJson);
      } catch {
        // Almost always a multi-line paste: dotenv stops at the first newline,
        // so the value arrives truncated. The JSON must be on ONE line.
        return "GOOGLE_CREDENTIALS_JSON is not valid JSON, paste the service-account file as a single line, with the \\n escapes inside private_key left as-is.";
      }
      if (parsed.type !== "service_account") return "GOOGLE_CREDENTIALS_JSON is JSON but not a service-account key (its \"type\" is not \"service_account\").";
      if (!parsed.private_key) return "GOOGLE_CREDENTIALS_JSON has no private_key.";
      if (parsed.project_id && parsed.project_id !== this.vertexProject) {
        // Not fatal, a key may legitimately be granted on another project ,
        // but it is far more often a typo, and silently wrong is worse.
        return `VERTEX_PROJECT is "${this.vertexProject}" but the credential belongs to "${parsed.project_id}". If that is deliberate the key needs Vertex access on ${this.vertexProject}; otherwise one of the two is a typo.`;
      }
    }
    return "";
  },

  // LiveKit (live video). If unset, the live-video endpoints return a clear
  // "not configured" error instead of crashing.
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  get livekitConfigured() {
    return !!(this.livekitUrl && this.livekitApiKey && this.livekitApiSecret);
  },

  // Admin API key, guards the user-listing endpoint (which exposes PII). When
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
  // this server strictly needs is the webhook secret, without it we cannot
  // verify that a webhook actually came from Razorpay, and an unverified
  // webhook is an open endpoint that would let anyone grant themselves a
  // subscription. `razorpayWebhookConfigured` is checked before any event is
  // applied; when false the endpoint rejects everything rather than trusting it.
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  // Key id/secret are only needed if we later create subscriptions from the
  // server (see RAZORPAY-SETUP.md - "linking a payment to an account").
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  // The hosted button to render on /pricing. Served to the frontend by
  // GET /api/subscription/config so the id is not hard-coded in the bundle.
  razorpaySubscriptionButtonId:
    process.env.RAZORPAY_SUBSCRIPTION_BUTTON_ID ?? "pl_TSKoRXpZy9rgRy",
  // Display price, in paise. ₹900 = 90000, matches the amount actually
  // configured on the pl_TSKoRXpZy9rgRy Razorpay plan (verified against
  // Razorpay's own API, not assumed). Razorpay's plan is still the source of
  // truth for what is actually charged; this only drives the pricing copy.
  // BestBrain Plus price. Set SUBSCRIPTION_PRICE_INR (e.g. 200) to change it;
  // SUBSCRIPTION_PRICE_PAISE still works and wins if both are set.
  subscriptionPricePaise: Number(
    process.env.SUBSCRIPTION_PRICE_PAISE ??
      Math.round(Number(process.env.SUBSCRIPTION_PRICE_INR ?? 200) * 100)
  ),
  // Online payment is off until the business switches it on: no plan checkout
  // and no coin packs. COIN_STORE_ENABLED / SUBSCRIPTION_CHECKOUT_ENABLED = true.
  // Plus includes this much AI usage every month, paid out as coins at
  // COINS_PER_RUPEE (3 coins ≈ ₹1 of real AI cost, the rate PAL is priced at).
  // ₹50 → 150 coins. Above it a student buys or wins coins.
  plusFreeUsageInr: Number(process.env.PLUS_FREE_USAGE_INR ?? 50),
  coinsPerRupee: Number(process.env.COINS_PER_RUPEE ?? 3),
  get plusMonthlyCoins(): number {
    return Math.max(0, Math.round(this.plusFreeUsageInr * this.coinsPerRupee));
  },
  coinStoreEnabled: process.env.COIN_STORE_ENABLED === "true",
  subscriptionCheckoutEnabled: process.env.SUBSCRIPTION_CHECKOUT_ENABLED === "true",
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

// FATAL config check, refuse to boot in production with a configuration that
// is actively insecure or data-losing. These are not warnings: running with
// dev JWT secrets lets anyone forge tokens, and an in-memory DB silently loses
// every user on restart. Called once on startup, before the server listens.
export function assertProductionConfig(): void {
  if (!env.isProd) return;

  const fatal: string[] = [];

  if (env.accessSecret === DEV_ACCESS_SECRET || env.refreshSecret === DEV_REFRESH_SECRET) {
    fatal.push("JWT secrets are still the dev defaults, set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (anyone can forge tokens otherwise).");
  }
  if (!env.mongoUri || env.useMemoryDb) {
    fatal.push("No persistent database, set MONGODB_URI (in-memory data is lost on every restart).");
  }

  if (fatal.length > 0) {
    console.error("\n🛑 FATAL: refusing to start in production with insecure config:");
    for (const p of fatal) console.error(`   - ${p}`);
    console.error("");
    throw new Error("Insecure production configuration, see the errors above.");
  }
}

// Loud, non-fatal warnings for config that is incomplete but not dangerous
// (a deploy is never blocked; the operator just sees what to fix).
export function warnInsecureConfig(): void {
  if (!env.isProd) return;

  const problems: string[] = [];

  // Two distinct states, and conflating them cost real debugging time: nothing
  // configured at all (PAL stubs, which is a choice), versus half-configured
  // (PAL 503s on every call, which is a mistake). Say which one this is.
  const vertexProblem = env.vertexConfigProblem;
  if (vertexProblem) {
    problems.push(`PAL is misconfigured and will fail on every request: ${vertexProblem}`);
  } else if (!env.vertexConfigured) {
    problems.push("PAL has no credentials, set GOOGLE_CREDENTIALS_JSON and VERTEX_PROJECT (or GOOGLE_APPLICATION_CREDENTIALS); PAL will return stub replies.");
  }

  if (!env.razorpayWebhookConfigured) {
    problems.push(
      "RAZORPAY_WEBHOOK_SECRET is unset, the subscription webhook rejects every event, so paid subscriptions will never activate an account. See RAZORPAY-SETUP.md."
    );
  }

  if (problems.length > 0) {
    console.warn("\n⚠️  INCOMPLETE PRODUCTION CONFIG:");
    for (const p of problems) console.warn(`   - ${p}`);
    console.warn("");
  }
}
