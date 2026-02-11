import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerTherapyTools(server: McpServer): void {
  // create_session
  server.tool(
    "create_therapy_session",
    "Create a therapy session log",
    {
      title: z.string().describe("Session title (e.g., 'Rose Day Incident')"),
      date: z.string().describe("Session date (ISO format)"),
      summary: z.string().optional().describe("Session summary"),
      patterns_identified: z.array(z.string()).optional().describe("Patterns identified during session"),
      action_items: z.array(z.string()).optional().describe("Action items from session"),
      emotional_state: z.string().optional().describe("Emotional state (before/during/after)"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
    },
    async ({ title, date, summary, patterns_identified, action_items, emotional_state, metadata }) => {
      const db = getDb("therapy");
      const id = generateId("ses");

      db.prepare(`
        INSERT INTO sessions (id, title, date, summary, patterns_identified, action_items, emotional_state, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, title, date,
        summary ?? null,
        patterns_identified ? JSON.stringify(patterns_identified) : null,
        action_items ? JSON.stringify(action_items) : null,
        emotional_state ?? null,
        metadata ? JSON.stringify(metadata) : null,
      );

      const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
    }
  );

  // get_sessions
  server.tool(
    "get_therapy_sessions",
    "Get therapy session logs",
    {
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ limit }) => {
      const db = getDb("therapy");
      const sessions = db.prepare(
        "SELECT * FROM sessions ORDER BY date DESC LIMIT ?"
      ).all(limit ?? 20);
      return { content: [{ type: "text" as const, text: JSON.stringify(sessions, null, 2) }] };
    }
  );

  // update_session
  server.tool(
    "update_therapy_session",
    "Update a therapy session's details",
    {
      id: z.string().describe("Session ID"),
      summary: z.string().optional().describe("Updated summary"),
      patterns_identified: z.array(z.string()).optional().describe("Updated patterns"),
      action_items: z.array(z.string()).optional().describe("Updated action items"),
      emotional_state: z.string().optional().describe("Updated emotional state"),
    },
    async ({ id, summary, patterns_identified, action_items, emotional_state }) => {
      const db = getDb("therapy");

      const existing = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Session '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (summary !== undefined) { updates.push("summary = ?"); params.push(summary); }
      if (patterns_identified !== undefined) { updates.push("patterns_identified = ?"); params.push(JSON.stringify(patterns_identified)); }
      if (action_items !== undefined) { updates.push("action_items = ?"); params.push(JSON.stringify(action_items)); }
      if (emotional_state !== undefined) { updates.push("emotional_state = ?"); params.push(emotional_state); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      params.push(id);
      db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
