import mongoose from "mongoose";
import { env } from "./env";

export async function connectDB(): Promise<void> {
  try {
    // Zero-setup local dev: if no real MONGODB_URI is given (or USE_MEMORY_DB
    // is set), spin up an in-memory MongoDB so the app runs with no external DB.
    if (env.useMemoryDb || !env.mongoUri) {
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const mem = await MongoMemoryServer.create();
      const uri = mem.getUri();
      await mongoose.connect(uri);
      console.log("✅ In-memory MongoDB connected (data resets on restart)");
      return;
    }

    await mongoose.connect(env.mongoUri);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}
