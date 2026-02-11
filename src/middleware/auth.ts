import type { Request, Response, NextFunction } from "express";
import { recordAuthFailure, clearAuthFailures } from "./ban.js";
import { writeSecurityLog } from "./logger.js";

/**
 * Middleware: Validate auth token from query param (?auth=) or X-Auth-Token header.
 * Query param is checked first (for Claude.ai which doesn't support custom headers).
 * On failure: increments fail counter (may trigger auto-ban), returns 401.
 * On success: clears failure record for this IP.
 */
export function authToken(req: Request, res: Response, next: NextFunction): void {
  const token = (req.query.auth as string | undefined) || (req.headers["x-auth-token"] as string | undefined);
  const expected = process.env.AUTH_TOKEN;

  if (!expected) {
    writeSecurityLog({
      timestamp: new Date().toISOString(),
      ip: req.ip || req.socket.remoteAddress || "unknown",
      method: req.method,
      path: req.path,
      event: "AUTH_MISCONFIGURED",
      detail: "AUTH_TOKEN env var not set",
    });
    res.status(500).json({ error: "Server auth not configured" });
    return;
  }

  if (!token || token !== expected) {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const wasBanned = recordAuthFailure(req);

    writeSecurityLog({
      timestamp: new Date().toISOString(),
      ip,
      method: req.method,
      path: req.path,
      event: "AUTH_FAILED",
      detail: wasBanned ? "IP now banned" : "Invalid or missing token",
    });

    res.status(401).json({ error: "Unauthorized — invalid or missing auth token" });
    return;
  }

  // Valid token — clear any previous failures
  clearAuthFailures(req);
  next();
}
