import http from "http";
import mongoose from "mongoose";
import { app } from "./app";
import { connectDB } from "./config/db";
import { env, assertProductionConfig, warnInsecureConfig } from "./config/env";
import { initLiveSocket } from "./sockets/liveSocket";

async function start() {
  assertProductionConfig(); // refuse to boot with insecure prod config
  warnInsecureConfig(); // flag incomplete (non-fatal) config
  await connectDB();

  const server = http.createServer(app);
  initLiveSocket(server); // attach Socket.IO for live classes

  server.listen(env.port, () => {
    console.log(`🚀 EduLearn backend running on http://localhost:${env.port}`);
    console.log(`   Socket.IO live events ready`);
  });

  // Graceful shutdown: stop accepting new connections, then close the DB,
  // so an in-flight deploy/restart doesn't drop live requests or corrupt state.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully…`);
    server.close(async () => {
      try {
        await mongoose.connection.close();
      } catch {
        /* ignore */
      }
      console.log("Closed HTTP server and DB connection. Bye.");
      process.exit(0);
    });
    // Force-exit if something hangs past 10s.
    setTimeout(() => {
      console.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
