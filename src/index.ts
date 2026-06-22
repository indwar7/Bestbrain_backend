import http from "http";
import { app } from "./app";
import { connectDB } from "./config/db";
import { env, warnInsecureConfig } from "./config/env";
import { initLiveSocket } from "./sockets/liveSocket";

async function start() {
  warnInsecureConfig(); // flag insecure/missing secrets in production
  await connectDB();

  const server = http.createServer(app);
  initLiveSocket(server); // attach Socket.IO for live classes

  server.listen(env.port, () => {
    console.log(`🚀 EduLearn backend running on http://localhost:${env.port}`);
    console.log(`   Socket.IO live events ready`);
  });
}

start();
