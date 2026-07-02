import { Request, Response, NextFunction, RequestHandler } from "express";

// Wraps an async route handler so a rejected promise (e.g. a DB error) is
// forwarded to Express's error middleware instead of becoming an unhandled
// rejection that hangs the request (Express 4/5 don't auto-catch async throws).
//
// Usage: router.get("/", asyncHandler(controller))
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
