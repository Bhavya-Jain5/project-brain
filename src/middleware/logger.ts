import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(
  process.env.BRAIN_DATA_PATH || ".",
  "..",
  "logs"
);
const LOG_FILE = path.join(LOG_DIR, "security.log");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

export interface SecurityLogEntry {
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  status?: number;
  event?: string;
  detail?: string;
}

export function writeSecurityLog(entry: SecurityLogEntry): void {
  const line = JSON.stringify(entry);
  logStream.write(line + "\n");
}

/**
 * Middleware: Log every incoming request (runs first in the chain, always)
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const entry: SecurityLogEntry = {
    timestamp: new Date().toISOString(),
    ip,
    method: req.method,
    path: req.path,
  };

  // Capture response status after it finishes
  res.on("finish", () => {
    entry.status = res.statusCode;
    writeSecurityLog(entry);
  });

  next();
}
