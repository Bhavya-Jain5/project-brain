import type { Request, Response, NextFunction } from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { writeSecurityLog } from "./logger.js";

const rateLimiter = new RateLimiterMemory({
  points: 100,   // 100 requests
  duration: 60,  // per 60 seconds
});

/**
 * Middleware: Rate limit by IP — 100 req/min. Returns 429 if exceeded.
 */
export async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  try {
    await rateLimiter.consume(ip);
    next();
  } catch {
    writeSecurityLog({
      timestamp: new Date().toISOString(),
      ip,
      method: req.method,
      path: req.path,
      event: "RATE_LIMITED",
      detail: "Exceeded 100 req/min",
    });
    res.status(429).json({ error: "Too many requests — 100 per minute limit" });
  }
}
