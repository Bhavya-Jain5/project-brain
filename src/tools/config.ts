import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";

export function registerConfigTools(server: McpServer): void {
  // get_config
  server.tool(
    "get_config",
    "Get config value(s) from core.db. Provide key for a single value, prefix for a group (e.g. 'retrieval.'), or neither for all config.",
    {
      key: z.string().optional().describe("Exact config key to retrieve"),
      prefix: z.string().optional().describe("Key prefix to match (e.g. 'retrieval.' returns all retrieval weights)"),
    },
    async ({ key, prefix }) => {
      const db = getDb("core");

      if (key) {
        const row = db.prepare("SELECT * FROM config WHERE key = ?").get(key);
        if (!row) {
          return { content: [{ type: "text" as const, text: `Error: Config key '${key}' not found` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] };
      }

      if (prefix) {
        const rows = db.prepare("SELECT * FROM config WHERE key LIKE ? ORDER BY key").all(`${prefix}%`);
        return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
      }

      const rows = db.prepare("SELECT * FROM config ORDER BY key").all();
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // set_config
  server.tool(
    "set_config",
    "Set a config value in core.db (upsert). Value should be a JSON string.",
    {
      key: z.string().describe("Config key"),
      value: z.string().describe("JSON string value"),
      description: z.string().optional().describe("Human-readable description of this config key"),
    },
    async ({ key, value, description }) => {
      const db = getDb("core");

      db.prepare(`
        INSERT OR REPLACE INTO config (key, value, description, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(key, value, description ?? null);

      const row = db.prepare("SELECT * FROM config WHERE key = ?").get(key);
      return { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] };
    }
  );
}
