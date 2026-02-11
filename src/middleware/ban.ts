import type { Request, Response, NextFunction } from "express";
import { writeSecurityLog } from "./logger.js";

const MAX_FAILURES = 5;
const BAN_DURATION_MS = 60 * 60 * 1000; // 1 hour

interface FailRecord {
  count: number;
  bannedUntil: number | null;
}

const failTracker = new Map<string, FailRecord>();

function getIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Record a failed auth attempt for an IP. Returns true if the IP is now banned.
 */
export function recordAuthFailure(req: Request): boolean {
  const ip = getIp(req);
  const record = failTracker.get(ip) || { count: 0, bannedUntil: null };
  record.count++;

  if (record.count >= MAX_FAILURES) {
    record.bannedUntil = Date.now() + BAN_DURATION_MS;
    writeSecurityLog({
      timestamp: new Date().toISOString(),
      ip,
      method: req.method,
      path: req.path,
      event: "IP_BANNED",
      detail: `Banned for 1 hour after ${record.count} failed auth attempts`,
    });
  }

  failTracker.set(ip, record);
  return record.count >= MAX_FAILURES;
}

/**
 * Clear failure record for an IP on successful auth.
 */
export function clearAuthFailures(req: Request): void {
  const ip = getIp(req);
  failTracker.delete(ip);
}

/**
 * Middleware: Check if IP is banned. Returns 403 if banned.
 */
export function banCheck(req: Request, res: Response, next: NextFunction): void {
  const ip = getIp(req);
  const record = failTracker.get(ip);

  if (record?.bannedUntil) {
    if (Date.now() < record.bannedUntil) {
      const minutesLeft = Math.ceil((record.bannedUntil - Date.now()) / 60000);
      writeSecurityLog({
        timestamp: new Date().toISOString(),
        ip,
        method: req.method,
        path: req.path,
        event: "BANNED_REQUEST_BLOCKED",
        detail: `${minutesLeft} minutes remaining`,
      });
      res.status(403).json({ error: "Forbidden — IP temporarily banned" });
      return;
    }
    // Ban expired, clear record
    failTracker.delete(ip);
  }

  next();
}
