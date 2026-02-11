import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerPersonalityTools(server: McpServer): void {
  // save_personality_note
  server.tool(
    "save_personality_note",
    "Save a personality observation, learned behavior, or interaction pattern. Used for personality evolution over time.",
    {
      content: z.string().describe("The observation or learned behavior"),
      subcategory: z.enum([
        "communication_style", "observation", "boundary", "opinion",
        "inside_joke", "relationship", "preference", "growth",
      ]).describe("Type of personality note"),
      context: z.string().optional().describe("What triggered this observation"),
    },
    async ({ content, subcategory, context }) => {
      const db = getDb("core");
      const id = generateId("mem");
      const metadata = context ? JSON.stringify({ context }) : null;

      db.prepare(`
        INSERT INTO memories (id, content, category, subcategory, tags, source, metadata)
        VALUES (?, ?, 'personality', ?, '["personality", "evolved"]', 'claude_code', ?)
      `).run(id, content, subcategory, metadata);

      const memory = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(memory, null, 2) }] };
    }
  );
}
