import pino from "pino";
import { env } from "./env";

// -----------------------------------------------------------------------------
// Structured application logger.
//   - Production: JSON lines (one object per line), ready for CloudWatch / Loki
//     / any log aggregator, and for shipping to an error tracker.
//   - Development: pretty, colourised, human-readable output.
// Secrets are redacted so tokens/passwords/cookies never land in logs.
// -----------------------------------------------------------------------------
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.isProd ? "info" : "debug"),
  // Redact anywhere these keys appear in a logged object.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "refreshToken",
      "apiKey",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
  transport: env.isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      },
});

// -----------------------------------------------------------------------------
// Sentry-ready error capture.
//
// This is a no-op today (no external dependency, no account needed). To turn on
// real error tracking later:
//   1. npm i @sentry/node
//   2. In index.ts before start(): Sentry.init({ dsn: env.sentryDsn })
//   3. Replace the body below with: Sentry.captureException(err)
// Everything already calls captureException(), so wiring Sentry is localized here.
// -----------------------------------------------------------------------------
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  // Always log it structured, regardless of whether a tracker is configured.
  logger.error({ err, ...context }, "captured exception");

  // When a DSN is present but Sentry isn't wired yet, make that visible once
  // so it's obvious the integration still needs the 3 steps above.
  if (env.sentryDsn && !warnedNoSentry) {
    warnedNoSentry = true;
    logger.warn("SENTRY_DSN is set but @sentry/node is not installed, errors are logged only.");
  }
}

let warnedNoSentry = false;
