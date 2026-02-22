import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerChatSessionTools(server: McpServer): void {
  // start_session — begin tracking a conversation session
  server.tool(
    "start_session",
    "Start tracking a new conversation session. Ends any active session for this db first.",
    {
      db: dbEnum.describe("Which database context"),
      title: z.string().optional().describe("Session title"),
      project_id: z.string().optional().describe("If session is focused on a specific project"),
    },
    async ({ db: dbName, title, project_id }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("sess");

      // End any currently active session for this db
      db.prepare(`
        UPDATE chat_sessions SET status = 'ended', ended_at = datetime('now')
        WHERE db = ? AND status = 'active'
      `).run(dbName);

      db.prepare(`
        INSERT INTO chat_sessions (id, db, title, project_id)
        VALUES (?, ?, ?, ?)
      `).run(id, dbName, title ?? null, project_id ?? null);

      const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
    }
  );

  // update_session — update session summary and metadata
  server.tool(
    "update_session",
    "Update a session's summary, key decisions/facts, and increment message count.",
    {
      session_id: z.string().describe("Session ID to update"),
      summary: z.string().optional().describe("Updated session summary"),
      key_decisions: z.array(z.string()).optional().describe("Key decisions made this session"),
      key_facts: z.array(z.string()).optional().describe("Key facts learned this session"),
      increment_messages: z.boolean().optional().describe("Increment message count (default: true)"),
    },
    async ({ session_id, summary, key_decisions, key_facts, increment_messages }) => {
      const coreDb = getDb("core");
      // Search across all dbs for this session
      const dbs: DbName[] = ["core", "therapy", "dnd", "hlg"];
      let found = false;

      for (const dbName of dbs) {
        const db = getDb(dbName);
        const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(session_id);
        if (!session) continue;

        const updates: string[] = [];
        const params: unknown[] = [];

        if (summary !== undefined) { updates.push("summary = ?"); params.push(summary); }
        if (key_decisions !== undefined) { updates.push("key_decisions = ?"); params.push(JSON.stringify(key_decisions)); }
        if (key_facts !== undefined) { updates.push("key_facts = ?"); params.push(JSON.stringify(key_facts)); }
        if (increment_messages !== false) { updates.push("message_count = message_count + 1"); }

        if (updates.length > 0) {
          params.push(session_id);
          db.prepare(`UPDATE chat_sessions SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        }

        const updated = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(session_id);
        found = true;
        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      }

      if (!found) {
        return { content: [{ type: "text" as const, text: `Error: Session '${session_id}' not found` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: "No updates made" }] };
    }
  );

  // end_session — mark session as ended
  server.tool(
    "end_session",
    "End a conversation session. Sets ended_at and status to 'ended'.",
    {
      session_id: z.string().describe("Session ID to end"),
    },
    async ({ session_id }) => {
      const dbs: DbName[] = ["core", "therapy", "dnd", "hlg"];

      for (const dbName of dbs) {
        const db = getDb(dbName);
        const result = db.prepare(`
          UPDATE chat_sessions SET status = 'ended', ended_at = datetime('now')
          WHERE id = ? AND status = 'active'
        `).run(session_id);

        if (result.changes > 0) {
          const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(session_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
        }
      }

      return { content: [{ type: "text" as const, text: `Error: Active session '${session_id}' not found` }], isError: true };
    }
  );

  // get_recent_sessions — for continuity loading
  server.tool(
    "get_recent_sessions",
    "Get recent conversation sessions for continuity. Load at start of conversation to understand what was discussed before.",
    {
      db: dbEnum.describe("Which database"),
      limit: z.number().optional().describe("Max sessions to return (default: 5)"),
    },
    async ({ db: dbName, limit }) => {
      const db = getDb(dbName as DbName);
      const sessions = db.prepare(`
        SELECT * FROM chat_sessions WHERE db = ?
        ORDER BY started_at DESC LIMIT ?
      `).all(dbName, limit ?? 5);

      return { content: [{ type: "text" as const, text: JSON.stringify(sessions, null, 2) }] };
    }
  );
}
