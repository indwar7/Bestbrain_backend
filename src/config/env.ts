import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI"),
  jwtSecret: required("JWT_SECRET"),
  // Allowed CORS origins, split into an array
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:8000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
