import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";
import { autoEmbed } from "../utils/embeddings.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const itemTypeEnum = z.enum([
  "observation", "idea", "decision", "task", "question", "correction",
]);

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateDailyLog(db: ReturnType<typeof getDb>, dbName: string, date: string): { id: string; isNew: boolean } {
  const existing = db.prepare(
    "SELECT id FROM daily_logs WHERE db = ? AND log_date = ?"
  ).get(dbName, date) as { id: string } | undefined;

  if (existing) return { id: existing.id, isNew: false };

  const id = generateId("dlog");
  db.prepare(`
    INSERT INTO daily_logs (id, db, log_date) VALUES (?, ?, ?)
  `).run(id, dbName, date);
  return { id, isNew: true };
}

export function registerDailyLogTools(server: McpServer): void {
  // add_daily_log_item — quick append to today's log
  server.tool(
    "add_daily_log_item",
    "Quick-append an item to today's daily log. Auto-creates the log if needed. Low friction, high volume — use for anything worth noting.",
    {
      db: dbEnum.describe("Which database"),
      content: z.string().describe("The observation, idea, decision, etc."),
      item_type: itemTypeEnum.optional().describe("Type of item (default: observation)"),
      importance: z.number().min(1).max(10).optional().describe("Importance 1-10 (default: 5). Items >=7 are candidates for promotion."),
    },
    async ({ db: dbName, content, item_type, importance }) => {
      const db = getDb(dbName as DbName);
      const date = todayDate();
      const { id: dailyLogId } = getOrCreateDailyLog(db, dbName, date);

      const itemId = generateId("dlitem");
      db.prepare(`
        INSERT INTO daily_log_items (id, daily_log_id, content, item_type, importance)
        VALUES (?, ?, ?, ?, ?)
      `).run(itemId, dailyLogId, content, item_type ?? "observation", importance ?? 5);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ daily_log_id: dailyLogId, item_id: itemId, date }, null, 2),
        }],
      };
    }
  );

  // get_daily_log — get a day's log with all items
  server.tool(
    "get_daily_log",
    "Get a day's log with all items. Defaults to today.",
    {
      db: dbEnum.describe("Which database"),
      date: z.string().optional().describe("YYYY-MM-DD (defaults to today)"),
    },
    async ({ db: dbName, date }) => {
      const db = getDb(dbName as DbName);
      const targetDate = date ?? todayDate();

      const log = db.prepare(
        "SELECT * FROM daily_logs WHERE db = ? AND log_date = ?"
      ).get(dbName, targetDate);

      if (!log) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ log: null, items: [], message: `No log for ${targetDate}` }, null, 2) }] };
      }

      const items = db.prepare(
        "SELECT * FROM daily_log_items WHERE daily_log_id = ? ORDER BY importance DESC, created_at ASC"
      ).all((log as { id: string }).id);

      return { content: [{ type: "text" as const, text: JSON.stringify({ log, items }, null, 2) }] };
    }
  );

  // promote_daily_item — convert item to permanent memory
  server.tool(
    "promote_daily_item",
    "Promote a daily log item to a permanent memory. Updates item status and creates memory.",
    {
      db: dbEnum.describe("Which database"),
      item_id: z.string().describe("Daily log item ID to promote"),
      category: z.enum([
        "fact", "decision", "learning", "preference", "blocker",
        "observation", "personality", "value", "hard_constraint", "pattern", "action", "correction",
      ]).describe("Memory category for the promoted item"),
      tags: z.array(z.string()).optional().describe("Tags for the new memory"),
      importance: z.number().min(1).max(5).optional().describe("Memory importance 1-5 (default: 3)"),
    },
    async ({ db: dbName, item_id, category, tags, importance }) => {
      const db = getDb(dbName as DbName);

      const item = db.prepare("SELECT * FROM daily_log_items WHERE id = ?").get(item_id) as {
        id: string; content: string; status: string; daily_log_id: string;
      } | undefined;

      if (!item) {
        return { content: [{ type: "text" as const, text: `Error: Item '${item_id}' not found` }], isError: true };
      }
      if (item.status === "promoted") {
        return { content: [{ type: "text" as const, text: `Item '${item_id}' already promoted` }], isError: true };
      }

      const memId = generateId("mem");
      const histId = generateId("mhist");
      const tagsJson = tags ? JSON.stringify(tags) : null;

      const transaction = db.transaction(() => {
        // Create permanent memory
        db.prepare(`
          INSERT INTO memories (id, content, category, tags, source, importance, memory_type, confidence)
          VALUES (?, ?, ?, ?, 'claude_code', ?, 'permanent', 1.0)
        `).run(memId, item.content, category, tagsJson, importance ?? 3);

        // Update item status
        db.prepare(`
          UPDATE daily_log_items SET status = 'promoted', promoted_to_id = ? WHERE id = ?
        `).run(memId, item_id);

        // Log to memory history
        db.prepare(`
          INSERT INTO memory_history (id, db, memory_id, operation, content_after, reason)
          VALUES (?, ?, ?, 'promoted', ?, 'Promoted from daily log')
        `).run(histId, dbName, memId, item.content);
      });

      transaction();

      autoEmbed(db, "memories", memId, item.content);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ promoted: true, memory_id: memId, item_id }, null, 2),
        }],
      };
    }
  );

  // review_pending_items — list items needing review
  server.tool(
    "review_pending_items",
    "List pending daily log items from the last N days, sorted by importance. Use to decide what to promote or discard.",
    {
      db: dbEnum.describe("Which database"),
      days_back: z.number().optional().describe("How many days to look back (default: 7)"),
    },
    async ({ db: dbName, days_back }) => {
      const db = getDb(dbName as DbName);
      const days = days_back ?? 7;

      const items = db.prepare(`
        SELECT dli.*, dl.log_date FROM daily_log_items dli
        JOIN daily_logs dl ON dl.id = dli.daily_log_id
        WHERE dl.db = ? AND dli.status = 'pending'
          AND dl.log_date >= date('now', '-' || ? || ' days')
        ORDER BY dli.importance DESC, dl.log_date DESC
      `).all(dbName, days);

      return { content: [{ type: "text" as const, text: JSON.stringify({ count: items.length, items }, null, 2) }] };
    }
  );

  // cleanup_daily_logs — auto-discard old low-importance items
  server.tool(
    "cleanup_daily_logs",
    "Clean up old daily log items. Auto-discards low-importance pending items older than N days. Archives old logs.",
    {
      db: dbEnum.describe("Which database"),
      days_old: z.number().optional().describe("Discard pending items older than this (default: 7)"),
    },
    async ({ db: dbName, days_old }) => {
      const db = getDb(dbName as DbName);
      const days = days_old ?? 7;

      const transaction = db.transaction(() => {
        // Auto-discard low importance items (< 4) older than days_old
        const discarded = db.prepare(`
          UPDATE daily_log_items SET status = 'discarded'
          WHERE status = 'pending' AND importance < 4
            AND daily_log_id IN (
              SELECT id FROM daily_logs WHERE db = ? AND log_date < date('now', '-' || ? || ' days')
            )
        `).run(dbName, days);

        // Archive old daily logs (> 30 days)
        const archived = db.prepare(`
          UPDATE daily_logs SET status = 'archived', updated_at = datetime('now')
          WHERE db = ? AND status = 'active' AND log_date < date('now', '-30 days')
        `).run(dbName);

        return { discarded_items: discarded.changes, archived_logs: archived.changes };
      });

      const result = transaction();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
