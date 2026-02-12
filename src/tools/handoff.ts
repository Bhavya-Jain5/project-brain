import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const clientEnum = z.enum(["chat", "code"]);
const entryTypeEnum = z.enum(["context", "task", "progress", "question", "decision", "done"]);

function resolveClient(override?: "chat" | "code"): "chat" | "code" {
  if (override) return override;
  return "chat";
}

function lastSeenCol(client: "chat" | "code"): string {
  return client === "chat" ? "chat_last_seen" : "code_last_seen";
}

interface HandoffRow {
  id: string;
  title: string;
  project: string | null;
  chat_last_seen: number;
  code_last_seen: number;
  status: string;
  created_at: string;
  updated_at: string | null;
}

interface EntryRow {
  seq: number;
  handoff_id: string;
  from_client: string;
  type: string;
  content: string;
  created_at: string;
}

export function registerHandoffTools(server: McpServer): void {
  // ── create_handoff ──────────────────────────────────────────────
  server.tool(
    "create_handoff",
    "Create a new handoff session between Chat and Code. Returns an ID to share with the other client.",
    {
      title: z.string().describe("Short title for this handoff session"),
      content: z.string().describe("Initial context to share"),
      project: z.string().optional().describe("Optional project tag: 'dnd', 'hlg', etc."),
      as_client: clientEnum.optional().describe("Set to 'code' from Claude Code. Omit for Chat/Desktop."),
    },
    async ({ title, content, project, as_client }) => {
      const db = getDb("core");
      const client = resolveClient(as_client);
      const id = generateId("hof");
      const now = new Date().toISOString();

      const txn = db.transaction(() => {
        db.prepare(`
          INSERT INTO handoffs (id, title, project, ${lastSeenCol(client)}, created_at, updated_at)
          VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
        `).run(id, title, project ?? null);

        db.prepare(`
          INSERT INTO handoff_entries (handoff_id, from_client, type, content)
          VALUES (?, ?, 'context', ?)
        `).run(id, client, content);
      });
      txn();

      const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow;
      const entries = db.prepare("SELECT * FROM handoff_entries WHERE handoff_id = ? ORDER BY seq").all(id) as EntryRow[];

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ handoff, entries }, null, 2),
        }],
      };
    }
  );

  // ── get_handoff ─────────────────────────────────────────────────
  server.tool(
    "get_handoff",
    "Retrieve a handoff session by ID. Shows all entries and highlights new (unseen) ones for the current client.",
    {
      id: z.string().describe("Handoff ID (e.g. hof_abc123)"),
      as_client: clientEnum.optional().describe("Set to 'code' from Claude Code. Omit for Chat/Desktop."),
    },
    async ({ id, as_client }) => {
      const db = getDb("core");
      const client = resolveClient(as_client);

      const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow | undefined;
      if (!handoff) {
        return {
          content: [{ type: "text" as const, text: `Handoff '${id}' not found.` }],
          isError: true,
        };
      }

      const entries = db.prepare(
        "SELECT * FROM handoff_entries WHERE handoff_id = ? ORDER BY seq"
      ).all(id) as EntryRow[];

      const lastSeen = handoff[lastSeenCol(client) as keyof HandoffRow] as number;
      const newEntries = entries.filter(e => e.seq > lastSeen);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            handoff,
            entries,
            new_entries: newEntries,
            new_count: newEntries.length,
          }, null, 2),
        }],
      };
    }
  );

  // ── add_to_handoff ──────────────────────────────────────────────
  server.tool(
    "add_to_handoff",
    "Append an entry to an active handoff session.",
    {
      id: z.string().describe("Handoff ID"),
      type: entryTypeEnum.describe("Entry type: context, task, progress, question, decision, done"),
      content: z.string().describe("The message content"),
      as_client: clientEnum.optional().describe("Set to 'code' from Claude Code. Omit for Chat/Desktop."),
    },
    async ({ id, type, content, as_client }) => {
      const db = getDb("core");
      const client = resolveClient(as_client);

      const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow | undefined;
      if (!handoff) {
        return {
          content: [{ type: "text" as const, text: `Handoff '${id}' not found.` }],
          isError: true,
        };
      }
      if (handoff.status !== "active") {
        return {
          content: [{ type: "text" as const, text: `Handoff '${id}' is already completed.` }],
          isError: true,
        };
      }

      const txn = db.transaction(() => {
        db.prepare(`
          INSERT INTO handoff_entries (handoff_id, from_client, type, content)
          VALUES (?, ?, ?, ?)
        `).run(id, client, type, content);

        const maxSeq = (db.prepare(
          "SELECT MAX(seq) as max_seq FROM handoff_entries WHERE handoff_id = ?"
        ).get(id) as { max_seq: number }).max_seq;

        db.prepare(`
          UPDATE handoffs SET ${lastSeenCol(client)} = ?, updated_at = datetime('now') WHERE id = ?
        `).run(maxSeq, id);
      });
      txn();

      const updatedHandoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow;
      const newEntry = db.prepare(
        "SELECT * FROM handoff_entries WHERE handoff_id = ? ORDER BY seq DESC LIMIT 1"
      ).get(id) as EntryRow;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ handoff: updatedHandoff, entry: newEntry }, null, 2),
        }],
      };
    }
  );

  // ── mark_handoff_read ───────────────────────────────────────────
  server.tool(
    "mark_handoff_read",
    "Mark all entries in a handoff as read for the current client.",
    {
      id: z.string().describe("Handoff ID"),
      as_client: clientEnum.optional().describe("Set to 'code' from Claude Code. Omit for Chat/Desktop."),
    },
    async ({ id, as_client }) => {
      const db = getDb("core");
      const client = resolveClient(as_client);

      const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow | undefined;
      if (!handoff) {
        return {
          content: [{ type: "text" as const, text: `Handoff '${id}' not found.` }],
          isError: true,
        };
      }

      const maxSeq = (db.prepare(
        "SELECT COALESCE(MAX(seq), 0) as max_seq FROM handoff_entries WHERE handoff_id = ?"
      ).get(id) as { max_seq: number }).max_seq;

      db.prepare(`
        UPDATE handoffs SET ${lastSeenCol(client)} = ?, updated_at = datetime('now') WHERE id = ?
      `).run(maxSeq, id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ marked_read: true, client, last_seen: maxSeq }, null, 2),
        }],
      };
    }
  );

  // ── close_handoff ───────────────────────────────────────────────
  server.tool(
    "close_handoff",
    "Close a handoff session and delete all its entries.",
    {
      id: z.string().describe("Handoff ID"),
    },
    async ({ id }) => {
      const db = getDb("core");

      const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as HandoffRow | undefined;
      if (!handoff) {
        return {
          content: [{ type: "text" as const, text: `Handoff '${id}' not found.` }],
          isError: true,
        };
      }

      const txn = db.transaction(() => {
        db.prepare("DELETE FROM handoff_entries WHERE handoff_id = ?").run(id);
        db.prepare(`
          UPDATE handoffs SET status = 'completed', updated_at = datetime('now') WHERE id = ?
        `).run(id);
      });
      txn();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ closed: true, id, title: handoff.title }, null, 2),
        }],
      };
    }
  );
}
