import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, getAllDbNames, isValidDbName, type DbName } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerSearchTools(server: McpServer): void {
  // search — single database FTS5 search
  server.tool(
    "search",
    "Full-text search across memories and entities in a single database",
    {
      db: dbEnum.describe("Which database to search"),
      query: z.string().describe("Search query (FTS5 syntax supported)"),
      types: z.array(z.enum(["memory", "entity"])).optional().describe("Search memories, entities, or both (default: both)"),
      limit: z.number().optional().describe("Max results per type (default: 20)"),
    },
    async ({ db: dbName, query, types, limit }) => {
      const db = getDb(dbName as DbName);
      const maxResults = limit ?? 20;
      const searchTypes = types ?? ["memory", "entity"];
      const result: { memories?: unknown[]; entities?: unknown[] } = {};

      // Sanitize query for FTS5 — wrap bare terms in quotes if needed
      const safeQuery = sanitizeFtsQuery(query);

      if (searchTypes.includes("memory")) {
        try {
          result.memories = db.prepare(`
            SELECT m.*, rank FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.rowid
            WHERE memories_fts MATCH ?
            AND m.status = 'active'
            ORDER BY rank
            LIMIT ?
          `).all(safeQuery, maxResults);
        } catch {
          // Fallback to LIKE search if FTS query is malformed
          result.memories = db.prepare(`
            SELECT * FROM memories
            WHERE (content LIKE ? OR tags LIKE ?) AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(`%${query}%`, `%${query}%`, maxResults);
        }
      }

      // Update access tracking for returned memories
      if (result.memories && result.memories.length > 0) {
        const updateAccess = db.prepare(`
          UPDATE memories SET
            access_count = access_count + 1,
            last_accessed_at = datetime('now'),
            decay_score = MIN(1.0, COALESCE(decay_score, 1.0) + 0.1)
          WHERE id = ?
        `);
        for (const mem of result.memories as { id: string }[]) {
          updateAccess.run(mem.id);
        }
      }

      if (searchTypes.includes("entity")) {
        try {
          result.entities = db.prepare(`
            SELECT e.*, rank FROM entities e
            JOIN entities_fts ON entities_fts.rowid = e.rowid
            WHERE entities_fts MATCH ?
            AND e.status = 'active'
            ORDER BY rank
            LIMIT ?
          `).all(safeQuery, maxResults);
        } catch {
          result.entities = db.prepare(`
            SELECT * FROM entities
            WHERE (name LIKE ? OR description LIKE ? OR tags LIKE ?) AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(`%${query}%`, `%${query}%`, `%${query}%`, maxResults);
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // search_all — search across ALL databases
  server.tool(
    "search_all",
    "Full-text search across ALL databases (or specified subset)",
    {
      query: z.string().describe("Search query"),
      dbs: z.array(dbEnum).optional().describe("Databases to search (default: all)"),
      limit: z.number().optional().describe("Max results per type per db (default: 10)"),
    },
    async ({ query, dbs, limit }) => {
      const dbNames = dbs ?? getAllDbNames();
      const maxResults = limit ?? 10;
      const safeQuery = sanitizeFtsQuery(query);
      const results: Record<string, { memories: unknown[]; entities: unknown[] }> = {};

      for (const name of dbNames) {
        if (!isValidDbName(name)) continue;
        // Ensure schema exists before querying
        initializeSchema(name);
        const db = getDb(name);

        let memories: unknown[] = [];
        let entities: unknown[] = [];

        try {
          memories = db.prepare(`
            SELECT m.*, rank FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.rowid
            WHERE memories_fts MATCH ?
            AND m.status = 'active'
            ORDER BY rank
            LIMIT ?
          `).all(safeQuery, maxResults);
        } catch {
          memories = db.prepare(`
            SELECT * FROM memories
            WHERE (content LIKE ? OR tags LIKE ?) AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(`%${query}%`, `%${query}%`, maxResults);
        }

        try {
          entities = db.prepare(`
            SELECT e.*, rank FROM entities e
            JOIN entities_fts ON entities_fts.rowid = e.rowid
            WHERE entities_fts MATCH ?
            AND e.status = 'active'
            ORDER BY rank
            LIMIT ?
          `).all(safeQuery, maxResults);
        } catch {
          entities = db.prepare(`
            SELECT * FROM entities
            WHERE (name LIKE ? OR description LIKE ? OR tags LIKE ?) AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(`%${query}%`, `%${query}%`, `%${query}%`, maxResults);
        }

        // Update access tracking for returned memories
        if (memories.length > 0) {
          const updateAccess = db.prepare(`
            UPDATE memories SET
              access_count = access_count + 1,
              last_accessed_at = datetime('now'),
              decay_score = MIN(1.0, COALESCE(decay_score, 1.0) + 0.1)
            WHERE id = ?
          `);
          for (const mem of memories as { id: string }[]) {
            updateAccess.run(mem.id);
          }
        }

        if (memories.length > 0 || entities.length > 0) {
          results[name] = { memories, entities };
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    }
  );
}

/**
 * Sanitize a query for FTS5. If it contains no FTS operators, wrap each word in quotes.
 */
function sanitizeFtsQuery(query: string): string {
  // If the query already uses FTS5 operators, pass through
  const ftsOperators = /["\*]|AND|OR|NOT|NEAR/;
  if (ftsOperators.test(query)) {
    return query;
  }
  // Otherwise, wrap each term in double quotes for exact matching
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '""';
  return terms.map(t => `"${t}"`).join(" ");
}
