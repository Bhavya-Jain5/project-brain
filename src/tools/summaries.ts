import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const summaryTypeEnum = z.enum(["daily", "weekly", "monthly", "project", "topic"]);

export function registerSummaryTools(server: McpServer): void {
  // create_summary
  server.tool(
    "create_summary",
    "Create a new summary (daily, weekly, monthly, project, or topic). Use to consolidate memories and sessions into digestible overviews.",
    {
      db: dbEnum.describe("Which database to save to"),
      summary_type: summaryTypeEnum.describe("Type of summary"),
      content: z.string().describe("The summary content"),
      title: z.string().optional().describe("Summary title"),
      period_start: z.string().optional().describe("Period start date (ISO 8601, e.g. '2026-02-01')"),
      period_end: z.string().optional().describe("Period end date (ISO 8601, e.g. '2026-02-07')"),
      project_id: z.string().optional().describe("Associated project entity ID"),
      topic: z.string().optional().describe("Topic or theme this summary covers"),
      source_memory_ids: z.array(z.string()).optional().describe("IDs of memories this summary draws from"),
      source_session_ids: z.array(z.string()).optional().describe("IDs of sessions this summary draws from"),
      memory_count: z.number().optional().describe("Number of memories covered"),
      completeness: z.number().min(0).max(1).optional().describe("Completeness score 0-1 (1 = fully comprehensive)"),
      needs_review: z.boolean().optional().describe("Flag for human review (default: false)"),
    },
    async ({ db: dbName, summary_type, content, title, period_start, period_end, project_id, topic, source_memory_ids, source_session_ids, memory_count, completeness, needs_review }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("sum");

      db.prepare(`
        INSERT INTO summaries (id, db, summary_type, content, title, period_start, period_end, project_id, topic, source_memory_ids, source_session_ids, memory_count, completeness, needs_review)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        dbName,
        summary_type,
        content,
        title ?? null,
        period_start ?? null,
        period_end ?? null,
        project_id ?? null,
        topic ?? null,
        source_memory_ids ? JSON.stringify(source_memory_ids) : null,
        source_session_ids ? JSON.stringify(source_session_ids) : null,
        memory_count ?? null,
        completeness ?? null,
        needs_review ? 1 : 0,
      );

      const summary = db.prepare("SELECT * FROM summaries WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // get_summaries
  server.tool(
    "get_summaries",
    "Get summaries with optional filters (type, project, topic, date range, review status)",
    {
      db: dbEnum.describe("Which database to query"),
      summary_type: summaryTypeEnum.optional().describe("Filter by summary type"),
      project_id: z.string().optional().describe("Filter by project ID"),
      topic: z.string().optional().describe("Filter by topic"),
      after_date: z.string().optional().describe("Only summaries with period_start after this date (ISO 8601)"),
      before_date: z.string().optional().describe("Only summaries with period_start before this date (ISO 8601)"),
      needs_review: z.boolean().optional().describe("Filter by review status"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, summary_type, project_id, topic, after_date, before_date, needs_review, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = ["db = ?"];
      const params: unknown[] = [dbName];

      if (summary_type) {
        conditions.push("summary_type = ?");
        params.push(summary_type);
      }
      if (project_id) {
        conditions.push("project_id = ?");
        params.push(project_id);
      }
      if (topic) {
        conditions.push("topic = ?");
        params.push(topic);
      }
      if (after_date) {
        conditions.push("period_start >= ?");
        params.push(after_date);
      }
      if (before_date) {
        conditions.push("period_start <= ?");
        params.push(before_date);
      }
      if (needs_review !== undefined) {
        conditions.push("needs_review = ?");
        params.push(needs_review ? 1 : 0);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM summaries ${where} ORDER BY generated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit ?? 20, offset ?? 0);

      const summaries = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(summaries, null, 2) }] };
    }
  );
}
