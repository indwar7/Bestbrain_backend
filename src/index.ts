import http from "http";
import mongoose from "mongoose";
import { app } from "./app";
import { connectDB } from "./config/db";
import { env, assertProductionConfig, warnInsecureConfig } from "./config/env";
import { logger, captureException } from "./config/logger";
import { initLiveSocket } from "./sockets/liveSocket";

// Never let an unhandled error silently take the process down without a trace.
process.on("unhandledRejection", (reason) => captureException(reason, { kind: "unhandledRejection" }));
process.on("uncaughtException", (err) => {
  captureException(err, { kind: "uncaughtException" });
  // An uncaught exception leaves the process in an unknown state — exit so the
  // orchestrator (pm2/systemd/ECS) can restart cleanly.
  process.exit(1);
});

async function start() {
  assertProductionConfig(); // refuse to boot with insecure prod config
  warnInsecureConfig(); // flag incomplete (non-fatal) config
  await connectDB();

  const server = http.createServer(app);
  initLiveSocket(server); // attach Socket.IO for live classes

  // Connection-level timeouts so slow clients / half-open sockets can't pile up
  // and exhaust resources under load. These are SSE-safe (they bound header
  // receipt and idle keep-alive, not the length of a streaming response body).
  server.keepAliveTimeout = 65_000; // > typical LB idle timeout to avoid races
  server.headersTimeout = 66_000; // must exceed keepAliveTimeout
  server.requestTimeout = 0; // disable the hard per-request cap (PAL SSE streams)

  server.listen(env.port, () => {
    logger.info({ port: env.port }, `🚀 EduLearn backend running on http://localhost:${env.port}`);
    logger.info("Socket.IO live events ready");
    // Surface the CORS policy at boot. A blocked origin shows up in the browser
    // only as an opaque "Failed to fetch", which is easy to misread as "the
    // server is down" — printing the allowlist makes it a one-glance diagnosis.
    logger.info(
      {
        allowedOrigins: env.clientOrigins,
        anyLocalhostAllowed: !env.isProd,
      },
      `CORS: ${env.clientOrigins.length} configured origin(s)` +
        (env.isProd
          ? " — production, CLIENT_ORIGIN only"
          : " + any localhost port (development)")
    );
  });

  // Graceful shutdown: stop accepting new connections, then close the DB,
  // so an in-flight deploy/restart doesn't drop live requests or corrupt state.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully…");
    server.close(async () => {
      try {
        await mongoose.connection.close();
      } catch {
        /* ignore */
      }
      logger.info("closed HTTP server and DB connection");
      process.exit(0);
    });
    // Force-exit if something hangs past 10s.
    setTimeout(() => {
      logger.error("forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  captureException(err, { kind: "startupFailure" });
  process.exit(1);
});
