import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);
const itemType = z.enum(["memory", "entity"]);

export function registerLinkTools(server: McpServer): void {
  // create_link
  server.tool(
    "create_link",
    "Create a relationship link between memories and/or entities",
    {
      db: dbEnum.describe("Which database"),
      source_type: itemType.describe("Type of source: 'memory' or 'entity'"),
      source_id: z.string().describe("ID of source item"),
      target_type: itemType.describe("Type of target: 'memory' or 'entity'"),
      target_id: z.string().describe("ID of target item"),
      relationship: z.string().describe("Relationship type: relates_to, supersedes, contradicts, depends_on, part_of, etc."),
      strength: z.number().min(0).max(1).optional().describe("Connection strength 0-1 (default: 1.0)"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
    },
    async ({ db: dbName, source_type, source_id, target_type, target_id, relationship, strength, metadata }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("lnk");
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      try {
        db.prepare(`
          INSERT INTO links (id, source_type, source_id, target_type, target_id, relationship, strength, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, source_type, source_id, target_type, target_id, relationship, strength ?? 1.0, metadataJson);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE constraint")) {
          return { content: [{ type: "text" as const, text: "This exact link already exists" }], isError: true };
        }
        throw err;
      }

      const link = db.prepare("SELECT * FROM links WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(link, null, 2) }] };
    }
  );

  // get_links
  server.tool(
    "get_links",
    "Get links filtered by source, target, or relationship",
    {
      db: dbEnum.describe("Which database"),
      source_id: z.string().optional().describe("Filter by source ID"),
      target_id: z.string().optional().describe("Filter by target ID"),
      relationship: z.string().optional().describe("Filter by relationship type"),
    },
    async ({ db: dbName, source_id, target_id, relationship }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (source_id) {
        conditions.push("source_id = ?");
        params.push(source_id);
      }
      if (target_id) {
        conditions.push("target_id = ?");
        params.push(target_id);
      }
      if (relationship) {
        conditions.push("relationship = ?");
        params.push(relationship);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const links = db.prepare(`SELECT * FROM links ${where} ORDER BY created_at DESC`).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(links, null, 2) }] };
    }
  );

  // delete_link
  server.tool(
    "delete_link",
    "Delete a relationship link",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Link ID to delete"),
    },
    async ({ db: dbName, id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM links WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Link '${id}' not found` }], isError: true };
      }

      db.prepare("DELETE FROM links WHERE id = ?").run(id);
      return { content: [{ type: "text" as const, text: `Deleted link '${id}'` }] };
    }
  );
}
