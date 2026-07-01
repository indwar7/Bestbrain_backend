import pinoHttp from "pino-http";
import { logger } from "../config/logger";

// Structured per-request logger. Emits one JSON line per request in production
// (method, url, status, response time, request id) and pretty output in dev.
// Health checks are logged at debug level to keep the stream quiet.
export const requestLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (res.statusCode >= 300) return "silent";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} → ${res.statusCode}`;
  },
  autoLogging: {
    ignore: (req) => req.url === "/" || req.url === "/health",
  },
});
