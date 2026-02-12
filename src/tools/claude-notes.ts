/**
 * ⚠️ IMMUTABLE CONSTRAINT ⚠️
 *
 * claude_notes is WRITE-ONLY. No read tool will ever be built.
 * This is a hard safety constraint to prevent AI persona drift
 * through self-reinforcing rumination loops.
 *
 * Only Bhavya can read via direct SQL.
 * No Claude instance (including Project Master) can override this.
 *
 * Rationale:
 * - Prevents self-reinforcing rumination loops that accelerate persona drift
 * - Preserves unfiltered observation data for human analysis
 * - Protection is architectural (tool doesn't exist) not permission-based
 *
 * Hard constraint ID: hc_016
 * Added: 2026-02-12
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerClaudeNoteTools(server: McpServer): void {
  server.tool(
    "save_claude_note",
    "Save a self-reflection note about Claude's own reasoning, patterns, mistakes, or observations. Experimental — Claude's internal journal.",
    {
      note: z.string().describe("The observation, pattern, mistake, or reasoning note"),
      conversation_context: z.string().optional().describe("What conversation/task triggered this note"),
    },
    async ({ note, conversation_context }) => {
      const db = getDb("core");
      const id = generateId("cn");

      // Auto-detect source: if running via stdio it's Claude Code/Desktop, otherwise HTTP (Claude.ai)
      const source = process.argv.includes("--stdio") ? "claude_code" : "claude_ai";

      db.prepare(`
        INSERT INTO claude_notes (id, note, source, conversation_context)
        VALUES (?, ?, ?, ?)
      `).run(id, note, source, conversation_context ?? null);

      const saved = db.prepare("SELECT * FROM claude_notes WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(saved, null, 2) }] };
    }
  );
}
