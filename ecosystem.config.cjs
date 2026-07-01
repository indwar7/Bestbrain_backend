// PM2 process config — run the backend across all CPU cores so one EC2 box can
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
//       worker can deliver to any client — the proper multi-core answer.
// Until (b) is wired, if live-class real-time misbehaves under cluster mode,
// set instances: 1 (REST still scales via the LB across boxes) or run a
// dedicated single-instance process just for sockets.
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "edulearn-backend",
      script: "dist/index.js",
      // "max" = one worker per CPU core. Lower it (e.g. 2) if the box is small
      // or until the Socket.IO Redis adapter is in place.
      instances: process.env.WEB_CONCURRENCY || "max",
      exec_mode: "cluster",
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
