import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "./logger";
import { User } from "../models/User";

// Connection-pool + timeout tuning for concurrency. maxPoolSize caps sockets
// per process; with cluster mode the effective total is maxPoolSize × workers,
// so keep it moderate for a self-hosted Mongo. The timeouts make a dead/slow DB
// fail fast (returning an error) instead of hanging requests under load.
const CONNECT_OPTIONS = {
  maxPoolSize: Number(process.env.MONGO_MAX_POOL ?? 50),
  minPoolSize: Number(process.env.MONGO_MIN_POOL ?? 5),
  serverSelectionTimeoutMS: 8_000, // give up finding a server after 8s
  socketTimeoutMS: 45_000, // drop a socket idle/blocked past 45s
  maxIdleTimeMS: 60_000, // reap idle pooled connections
};

export async function connectDB(): Promise<void> {
  try {
    // Zero-setup local dev: if no real MONGODB_URI is given (or USE_MEMORY_DB
    // is set), spin up an in-memory MongoDB so the app runs with no external DB.
    if (env.useMemoryDb || !env.mongoUri) {
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const mem = await MongoMemoryServer.create();
      const uri = mem.getUri();
      await mongoose.connect(uri);
      logger.info("in-memory MongoDB connected (data resets on restart)");
      return;
    }

    await mongoose.connect(env.mongoUri, CONNECT_OPTIONS);
    logger.info(
      { maxPoolSize: CONNECT_OPTIONS.maxPoolSize },
      "MongoDB connected"
    );

    // Mongoose's default autoIndex only ever ADDS indexes that are missing by
    // name — it never alters an existing index's options. The users collection
    // had a plain (non-unique) rollNumber index from before the schema added
    // `unique: true`, so duplicate roll numbers could still slip in and get
    // linked to the wrong parent. syncIndexes reconciles the real indexes with
    // the schema (rebuilding rollNumber_1 as unique); it throws if existing
    // data already violates the new constraint, so failure here is surfaced
    // rather than silently leaving the weaker index in place.
    try {
      await User.syncIndexes();
    } catch (err) {
      logger.error(
        { err },
        "User.syncIndexes failed — check for duplicate rollNumber/teacherId values before retrying"
      );
    }

    // Surface pool/connection errors after the initial connect instead of
    // crashing silently.
    mongoose.connection.on("error", (err) =>
      logger.error({ err }, "MongoDB connection error")
    );
    mongoose.connection.on("disconnected", () =>
      logger.warn("MongoDB disconnected")
    );
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed on startup");
    process.exit(1);
  }
}
