import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const sessionStatusEnum = z.enum(["active", "paused", "done"]);
const workerStatusEnum = z.enum(["idle", "working", "blocked", "done"]);

interface CoordSession {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CoordWorker {
  id: string;
  session_id: string;
  worker_name: string;
  description: string | null;
  status: string;
  current_task: string | null;
  created_at: string;
  updated_at: string;
}

interface CoordMessage {
  id: string;
  session_id: string;
  from_id: string;
  to_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
}

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export function registerCoordinationTools(server: McpServer): void {
  const db = () => getDb("core");

  // ══════════════════════════════════════════════════════
  // SESSION MANAGEMENT (coordinator)
  // ══════════════════════════════════════════════════════

  server.tool(
    "create_coord_session",
    "Create a new multi-CC coordination session. Returns the session ID to share with workers.",
    {
      title: z.string().describe("Short title for this coordination session"),
      description: z.string().optional().describe("What this session is about"),
    },
    async ({ title, description }) => {
      const id = generateId("coord");
      db().prepare(`
        INSERT INTO coordination_sessions (id, title, description)
        VALUES (?, ?, ?)
      `).run(id, title, description ?? null);

      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(id);
      return json(session);
    }
  );

  server.tool(
    "get_coord_sessions",
    "List coordination sessions, optionally filtered by status.",
    {
      status: sessionStatusEnum.optional().describe("Filter by status (active, paused, done)"),
    },
    async ({ status }) => {
      const sessions = status
        ? db().prepare("SELECT * FROM coordination_sessions WHERE status = ? ORDER BY created_at DESC").all(status)
        : db().prepare("SELECT * FROM coordination_sessions ORDER BY created_at DESC").all();
      return json(sessions);
    }
  );

  server.tool(
    "update_coord_session",
    "Update a coordination session's title, description, or status.",
    {
      id: z.string().describe("Session ID (coord_xxx)"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      status: sessionStatusEnum.optional().describe("New status"),
    },
    async ({ id, title, description, status }) => {
      const existing = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(id) as CoordSession | undefined;
      if (!existing) return err(`Session not found: ${id}`);

      const updates: string[] = [];
      const params: unknown[] = [];

      if (title !== undefined) { updates.push("title = ?"); params.push(title); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }

      if (updates.length === 0) return err("No fields to update");

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db().prepare(`UPDATE coordination_sessions SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(id);
      return json(session);
    }
  );

  server.tool(
    "close_coord_session",
    "Mark a coordination session as done.",
    {
      id: z.string().describe("Session ID (coord_xxx)"),
    },
    async ({ id }) => {
      const existing = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(id) as CoordSession | undefined;
      if (!existing) return err(`Session not found: ${id}`);

      db().prepare(`
        UPDATE coordination_sessions SET status = 'done', updated_at = datetime('now') WHERE id = ?
      `).run(id);

      // Also mark all workers as done
      db().prepare(`
        UPDATE coordination_workers SET status = 'done', updated_at = datetime('now') WHERE session_id = ?
      `).run(id);

      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(id);
      const workers = db().prepare("SELECT * FROM coordination_workers WHERE session_id = ?").all(id);
      return json({ session, workers });
    }
  );

  // ══════════════════════════════════════════════════════
  // WORKER MANAGEMENT (coordinator)
  // ══════════════════════════════════════════════════════

  server.tool(
    "add_coord_worker",
    "Register a worker (Claude Code instance) in a coordination session.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
      worker_name: z.string().describe("Unique name for this worker (e.g. 'cc-clean-crowd')"),
      description: z.string().optional().describe("What this worker is responsible for"),
    },
    async ({ session_id, worker_name, description }) => {
      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(session_id) as CoordSession | undefined;
      if (!session) return err(`Session not found: ${session_id}`);

      const id = generateId("cw");
      db().prepare(`
        INSERT INTO coordination_workers (id, session_id, worker_name, description)
        VALUES (?, ?, ?, ?)
      `).run(id, session_id, worker_name, description ?? null);

      const worker = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(id);
      return json(worker);
    }
  );

  server.tool(
    "get_coord_workers",
    "List all workers in a coordination session.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
    },
    async ({ session_id }) => {
      const workers = db().prepare(
        "SELECT * FROM coordination_workers WHERE session_id = ? ORDER BY created_at"
      ).all(session_id);
      return json(workers);
    }
  );

  server.tool(
    "update_coord_worker",
    "Update a worker's status, current task, or description.",
    {
      id: z.string().describe("Worker ID (cw_xxx)"),
      status: workerStatusEnum.optional().describe("New status"),
      current_task: z.string().optional().describe("What the worker is currently doing"),
      description: z.string().optional().describe("Updated description"),
    },
    async ({ id, status, current_task, description }) => {
      const existing = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(id) as CoordWorker | undefined;
      if (!existing) return err(`Worker not found: ${id}`);

      const updates: string[] = [];
      const params: unknown[] = [];

      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (current_task !== undefined) { updates.push("current_task = ?"); params.push(current_task); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }

      if (updates.length === 0) return err("No fields to update");

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db().prepare(`UPDATE coordination_workers SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const worker = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(id);
      return json(worker);
    }
  );

  server.tool(
    "remove_coord_worker",
    "Remove a worker from a coordination session.",
    {
      id: z.string().describe("Worker ID (cw_xxx)"),
    },
    async ({ id }) => {
      const existing = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(id) as CoordWorker | undefined;
      if (!existing) return err(`Worker not found: ${id}`);

      db().prepare("DELETE FROM coordination_workers WHERE id = ?").run(id);
      return json({ removed: id, worker_name: existing.worker_name });
    }
  );

  // ══════════════════════════════════════════════════════
  // MESSAGING (coordinator + workers)
  // ══════════════════════════════════════════════════════

  server.tool(
    "send_coord_message",
    "Send a message to another worker or coordinator in a coordination session.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
      from_id: z.string().describe("Sender: 'coordinator' or a worker ID (cw_xxx)"),
      to_id: z.string().describe("Recipient: 'coordinator' or a worker ID (cw_xxx)"),
      content: z.string().describe("Message content"),
    },
    async ({ session_id, from_id, to_id, content }) => {
      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(session_id) as CoordSession | undefined;
      if (!session) return err(`Session not found: ${session_id}`);

      const id = generateId("cm");
      db().prepare(`
        INSERT INTO coordination_messages (id, session_id, from_id, to_id, content)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, session_id, from_id, to_id, content);

      const msg = db().prepare("SELECT * FROM coordination_messages WHERE id = ?").get(id);
      return json(msg);
    }
  );

  server.tool(
    "get_coord_messages",
    "Get messages for a specific worker (or coordinator). Marks retrieved messages as read.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
      worker_id: z.string().describe("'coordinator' or a worker ID (cw_xxx)"),
      unread_only: z.boolean().optional().describe("Only return unread messages (default: false)"),
    },
    async ({ session_id, worker_id, unread_only }) => {
      let messages: CoordMessage[];
      if (unread_only) {
        messages = db().prepare(
          "SELECT * FROM coordination_messages WHERE session_id = ? AND to_id = ? AND read_at IS NULL ORDER BY created_at"
        ).all(session_id, worker_id) as CoordMessage[];
      } else {
        messages = db().prepare(
          "SELECT * FROM coordination_messages WHERE session_id = ? AND to_id = ? ORDER BY created_at"
        ).all(session_id, worker_id) as CoordMessage[];
      }

      // Mark as read
      if (messages.length > 0) {
        const unreadIds = messages.filter(m => !m.read_at).map(m => m.id);
        if (unreadIds.length > 0) {
          const placeholders = unreadIds.map(() => "?").join(", ");
          db().prepare(
            `UPDATE coordination_messages SET read_at = datetime('now') WHERE id IN (${placeholders})`
          ).run(...unreadIds);
        }
      }

      return json({ messages, unread_marked: messages.filter(m => !m.read_at).length });
    }
  );

  server.tool(
    "get_all_coord_messages",
    "Get all messages in a coordination session (coordinator view). Does not mark as read.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
    },
    async ({ session_id }) => {
      const messages = db().prepare(
        "SELECT * FROM coordination_messages WHERE session_id = ? ORDER BY created_at"
      ).all(session_id);
      return json(messages);
    }
  );

  // ══════════════════════════════════════════════════════
  // DOCS
  // ══════════════════════════════════════════════════════

  server.tool(
    "get_coordination_docs",
    "Returns markdown documentation explaining the coordination system. Workers call this once at session start to understand the workflow.",
    {},
    async () => {
      const docs = `# Coordination System

You are a worker in a multi-CC coordination system. Chat is the coordinator, you are a worker.

## Your Tools

- \`worker_checkin(session_id, worker_name)\` - Start of session. Returns your ID, unread messages, other workers.
- \`worker_report(session_id, worker_id, status, message)\` - Report to coordinator. Status: "working" | "blocked" | "done"
- \`send_coord_message(session_id, from_id, to_id, content)\` - Message coordinator or another worker
- \`get_coord_messages(session_id, worker_id)\` - Check your messages (marks as read)

## Workflow

1. Check in: \`worker_checkin(session_id, your_name)\`
2. Do assigned work
3. Need something from another worker? \`send_coord_message\` to them
4. Done or blocked? \`worker_report\` to coordinator

## Message Tips

- from_id/to_id: Use "coordinator" or the worker's cw_xxx ID
- Be specific about what you need
- Check messages periodically with \`get_coord_messages\``;

      return { content: [{ type: "text" as const, text: docs }] };
    }
  );

  // ══════════════════════════════════════════════════════
  // WORKER HELPERS
  // ══════════════════════════════════════════════════════

  server.tool(
    "worker_checkin",
    "Worker starting a session. Finds their worker record by name, returns their ID, unread messages, and other workers.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
      worker_name: z.string().describe("Worker's registered name (e.g. 'cc-clean-crowd')"),
    },
    async ({ session_id, worker_name }) => {
      const session = db().prepare("SELECT * FROM coordination_sessions WHERE id = ?").get(session_id) as CoordSession | undefined;
      if (!session) return err(`Session not found: ${session_id}`);

      const worker = db().prepare(
        "SELECT * FROM coordination_workers WHERE session_id = ? AND worker_name = ?"
      ).get(session_id, worker_name) as CoordWorker | undefined;
      if (!worker) return err(`Worker '${worker_name}' not registered in session ${session_id}`);

      // Get unread messages for this worker
      const unread = db().prepare(
        "SELECT * FROM coordination_messages WHERE session_id = ? AND to_id = ? AND read_at IS NULL ORDER BY created_at"
      ).all(session_id, worker.id) as CoordMessage[];

      // Get other workers
      const others = db().prepare(
        "SELECT id, worker_name, description, status, current_task FROM coordination_workers WHERE session_id = ? AND id != ?"
      ).all(session_id, worker.id);

      // Mark worker as working
      db().prepare(
        "UPDATE coordination_workers SET status = 'working', updated_at = datetime('now') WHERE id = ?"
      ).run(worker.id);

      return json({
        session: { id: session.id, title: session.title, description: session.description, status: session.status },
        worker: { id: worker.id, name: worker.worker_name, description: worker.description, current_task: worker.current_task },
        unread_messages: unread,
        other_workers: others,
      });
    }
  );

  server.tool(
    "worker_report",
    "Worker reports status to coordinator. Sends a message and updates worker status.",
    {
      session_id: z.string().describe("Session ID (coord_xxx)"),
      worker_id: z.string().describe("Worker ID (cw_xxx)"),
      status: workerStatusEnum.describe("Current status: working, blocked, done"),
      message: z.string().describe("Status report message"),
    },
    async ({ session_id, worker_id, status, message }) => {
      const worker = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(worker_id) as CoordWorker | undefined;
      if (!worker) return err(`Worker not found: ${worker_id}`);

      const txn = db().transaction(() => {
        // Update worker status
        db().prepare(
          "UPDATE coordination_workers SET status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(status, worker_id);

        // Send message to coordinator
        const msgId = generateId("cm");
        db().prepare(`
          INSERT INTO coordination_messages (id, session_id, from_id, to_id, content)
          VALUES (?, ?, ?, 'coordinator', ?)
        `).run(msgId, session_id, worker_id, `[${status.toUpperCase()}] ${message}`);
      });
      txn();

      const updated = db().prepare("SELECT * FROM coordination_workers WHERE id = ?").get(worker_id);
      return json({ worker: updated, reported: true });
    }
  );
}
