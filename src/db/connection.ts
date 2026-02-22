import Database from "better-sqlite3-multiple-ciphers";
import type BetterSqlite3 from "better-sqlite3";
import path from "path";
import * as sqliteVec from "sqlite-vec";

const DB_NAMES = ["core", "therapy", "dnd", "hlg"] as const;
export type DbName = (typeof DB_NAMES)[number];

export function isValidDbName(name: string): name is DbName {
  return DB_NAMES.includes(name as DbName);
}

const connections = new Map<DbName, BetterSqlite3.Database>();

export function getDb(name: DbName): BetterSqlite3.Database {
  const existing = connections.get(name);
  if (existing) return existing;

  const dataPath = process.env.BRAIN_DATA_PATH;
  if (!dataPath) {
    throw new Error("BRAIN_DATA_PATH environment variable not set");
  }

  const dbPath = path.join(dataPath, `${name}.db`);
  const db = new (Database as unknown as typeof BetterSqlite3)(dbPath);

  // Set encryption key
  const password = process.env.BRAIN_PASSWORD;
  if (password) {
    db.pragma(`key='${password}'`);
  }

  // Load sqlite-vec extension for vector search
  sqliteVec.load(db);

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  connections.set(name, db);
  return db;
}

export function getAllDbNames(): readonly string[] {
  return DB_NAMES;
}

export function closeAll(): void {
  for (const [, db] of connections) {
    db.close();
  }
  connections.clear();
}
