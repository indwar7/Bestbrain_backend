// PM2 process config, run the backend across all CPU cores so one EC2 box can
// handle far more concurrent users than a single Node process (Node is
// single-threaded; without this, extra cores sit idle).
//
// Usage on the server:
//   npm run build           # compile TS → dist/
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup # persist across reboots
//   pm2 reload edulearn-backend   # zero-downtime reload on deploy
//
// ── IMPORTANT: Socket.IO + cluster ──────────────────────────────────────────
// Live classes use Socket.IO. With multiple workers, WebSocket clients must
// stick to one worker AND workers must share events, or real-time breaks across
// processes. Two safe options:
//   (a) Keep `instances` at a MODERATE number and put a sticky-session load
//       balancer in front (nginx ip_hash / ALB stickiness), OR
//   (b) Add the Socket.IO Redis adapter (@socket.io/redis-adapter) so any
//       worker can deliver to any client, the proper multi-core answer.
// Until (b) is wired, if live-class real-time misbehaves under cluster mode,
// set instances: 1 (REST still scales via the LB across boxes) or run a
// dedicated single-instance process just for sockets.
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "edulearn-backend",
      script: "dist/index.js",
      // Live classes use Socket.IO with IN-MEMORY rooms/presence. Under cluster
      // mode each worker has its own memory, so with >1 worker (and no Redis
      // adapter / sticky sessions) chat messages, roster and join signals don't
      // cross workers, live chat and camera/mic joins appear broken/glitchy.
      // Pinned to a SINGLE instance so real-time works reliably. To scale across
      // cores again, wire @socket.io/redis-adapter first, then raise this.
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "500M", // restart a worker if it leaks past 500MB
      kill_timeout: 10_000, // give graceful shutdown time to drain
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
