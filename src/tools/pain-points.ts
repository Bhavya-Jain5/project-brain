import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerPainPointTools(server: McpServer): void {
  // log_pain_point
  server.tool(
    "log_pain_point",
    "Log something that sucks and needs fixing",
    {
      db: dbEnum.describe("Which database had the issue"),
      description: z.string().describe("What's broken or annoying"),
      context: z.string().optional().describe("When/where it happened"),
      severity: z.enum(["minor", "annoying", "major", "critical"]).optional().describe("How bad is it"),
    },
    async ({ db: dbName, description, context, severity }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("pp");

      db.prepare(`
        INSERT INTO pain_points (id, description, context, severity)
        VALUES (?, ?, ?, ?)
      `).run(id, description, context ?? null, severity ?? "minor");

      const painPoint = db.prepare("SELECT * FROM pain_points WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(painPoint, null, 2) }] };
    }
  );

  // get_pain_points
  server.tool(
    "get_pain_points",
    "Get pain points, optionally filtered by status or severity",
    {
      db: dbEnum.optional().describe("Filter by database (default: all)"),
      status: z.enum(["open", "fixing", "fixed", "wont_fix"]).optional().describe("Filter by status"),
      severity: z.enum(["minor", "annoying", "major", "critical"]).optional().describe("Filter by severity"),
    },
    async ({ db: dbName, status, severity }) => {
      if (dbName) {
        const db = getDb(dbName as DbName);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(queryPainPoints(db, status, severity), null, 2),
          }],
        };
      }

      // Query all DBs
      const allResults: Record<string, unknown[]> = {};
      for (const name of ["core", "therapy", "dnd", "hlg"] as const) {
        try {
          const db = getDb(name);
          const results = queryPainPoints(db, status, severity);
          if (results.length > 0) {
            allResults[name] = results;
          }
        } catch { /* db not initialized, skip */ }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(allResults, null, 2) }] };
    }
  );

  // resolve_pain_point
  server.tool(
    "resolve_pain_point",
    "Mark a pain point as resolved with a resolution description",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Pain point ID"),
      resolution: z.string().describe("How it was fixed"),
    },
    async ({ db: dbName, id, resolution }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM pain_points WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Pain point '${id}' not found` }], isError: true };
      }

      db.prepare(`
        UPDATE pain_points SET status = 'fixed', resolution = ?, resolved_at = datetime('now')
        WHERE id = ?
      `).run(resolution, id);

      const updated = db.prepare("SELECT * FROM pain_points WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}

function queryPainPoints(
  db: import("better-sqlite3").Database,
  status?: string,
  severity?: string,
): unknown[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  } else {
    conditions.push("status = 'open'");
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM pain_points ${where} ORDER BY created_at DESC`).all(...params);
}
