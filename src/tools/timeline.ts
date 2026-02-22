import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerTimelineTools(server: McpServer): void {
  // create_event
  server.tool(
    "create_event",
    "Create a new timeline event (milestone, deadline, release, decision, meeting, payment, learning, life_event)",
    {
      db: dbEnum.describe("Which database"),
      title: z.string().describe("Event title"),
      event_date: z.string().describe("Event date (ISO datetime or date string)"),
      description: z.string().optional().describe("Event description"),
      event_type: z.enum(["milestone", "deadline", "release", "decision", "meeting", "payment", "learning", "life_event"]).optional().describe("Type of event"),
      end_date: z.string().optional().describe("End date for multi-day events (ISO datetime or date string)"),
      is_all_day: z.boolean().optional().describe("Whether this is an all-day event (default true)"),
      is_recurring: z.boolean().optional().describe("Whether this event recurs (default false)"),
      recurrence_rule: z.string().optional().describe("Recurrence rule (e.g. 'weekly', 'monthly', RRULE string)"),
      importance: z.number().min(1).max(10).optional().describe("Importance 1-10 (default 5)"),
      project_id: z.string().optional().describe("Associated project entity ID"),
      entity_id: z.string().optional().describe("Associated entity ID"),
      memory_id: z.string().optional().describe("Associated memory ID"),
      reminder_before: z.array(z.string()).optional().describe("Reminder offsets before event (e.g. ['1h', '1d'])"),
    },
    async ({ db: dbName, title, event_date, description, event_type, end_date, is_all_day, is_recurring, recurrence_rule, importance, project_id, entity_id, memory_id, reminder_before }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("evt");

      db.prepare(`
        INSERT INTO timeline_events (id, db, title, description, event_type, event_date, end_date, is_all_day, timezone, is_recurring, recurrence_rule, importance, project_id, entity_id, memory_id, reminder_before)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Kolkata', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, dbName, title,
        description ?? null,
        event_type ?? null,
        event_date,
        end_date ?? null,
        is_all_day !== undefined ? (is_all_day ? 1 : 0) : 1,
        is_recurring !== undefined ? (is_recurring ? 1 : 0) : 0,
        recurrence_rule ?? null,
        importance ?? 5.0,
        project_id ?? null,
        entity_id ?? null,
        memory_id ?? null,
        reminder_before ? JSON.stringify(reminder_before) : null,
      );

      const event = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
    }
  );

  // get_events
  server.tool(
    "get_events",
    "Get timeline events with optional filters (type, status, date range, project)",
    {
      db: dbEnum.describe("Which database"),
      event_type: z.string().optional().describe("Filter by event type"),
      status: z.enum(["upcoming", "completed", "missed", "cancelled"]).optional().describe("Filter by status (default: upcoming)"),
      after_date: z.string().optional().describe("Only events after this date (ISO string)"),
      before_date: z.string().optional().describe("Only events before this date (ISO string)"),
      project_id: z.string().optional().describe("Filter by project ID"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, event_type, status, after_date, before_date, project_id, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) {
        conditions.push("status = ?");
        params.push(status);
      } else {
        conditions.push("status = 'upcoming'");
      }

      if (event_type) {
        conditions.push("event_type = ?");
        params.push(event_type);
      }
      if (after_date) {
        conditions.push("event_date >= ?");
        params.push(after_date);
      }
      if (before_date) {
        conditions.push("event_date <= ?");
        params.push(before_date);
      }
      if (project_id) {
        conditions.push("project_id = ?");
        params.push(project_id);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM timeline_events ${where} ORDER BY event_date ASC LIMIT ? OFFSET ?`;
      params.push(limit ?? 50, offset ?? 0);

      const events = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
    }
  );

  // update_event
  server.tool(
    "update_event",
    "Update an existing timeline event's details or status",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Event ID to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      event_type: z.string().optional().describe("New event type"),
      event_date: z.string().optional().describe("New event date"),
      end_date: z.string().optional().describe("New end date"),
      status: z.enum(["upcoming", "completed", "missed", "cancelled"]).optional().describe("New status"),
      importance: z.number().min(1).max(10).optional().describe("New importance (1-10)"),
      project_id: z.string().optional().describe("New project ID"),
      entity_id: z.string().optional().describe("New entity ID"),
    },
    async ({ db: dbName, id, title, description, event_type, event_date, end_date, status, importance, project_id, entity_id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Event '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (title !== undefined) { updates.push("title = ?"); params.push(title); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (event_type !== undefined) { updates.push("event_type = ?"); params.push(event_type); }
      if (event_date !== undefined) { updates.push("event_date = ?"); params.push(event_date); }
      if (end_date !== undefined) { updates.push("end_date = ?"); params.push(end_date); }
      if (importance !== undefined) { updates.push("importance = ?"); params.push(importance); }
      if (project_id !== undefined) { updates.push("project_id = ?"); params.push(project_id); }
      if (entity_id !== undefined) { updates.push("entity_id = ?"); params.push(entity_id); }

      if (status !== undefined) {
        updates.push("status = ?");
        params.push(status);
        if (status === "completed") {
          updates.push("completed_at = datetime('now')");
        }
      }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      params.push(id);

      db.prepare(`UPDATE timeline_events SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
