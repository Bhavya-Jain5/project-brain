import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";
import type BetterSqlite3 from "better-sqlite3";

/**
 * Log a search query for analytics. Called internally by search tools.
 * Non-throwing — silently catches errors so logging never breaks search.
 */
export function logQuery(
  db: BetterSqlite3.Database,
  entry: {
    db: string;
    queryText: string;
    querySource: string;
    resultCount: number;
    resultIds?: string[];
    executionTimeMs: number;
    sessionId?: string;
  }
): void {
  try {
    db.prepare(`
      INSERT INTO query_log (id, db, query_text, query_source, result_count, result_ids, execution_time_ms, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId("qlog"),
      entry.db,
      entry.queryText,
      entry.querySource,
      entry.resultCount,
      entry.resultIds ? JSON.stringify(entry.resultIds) : null,
      entry.executionTimeMs,
      entry.sessionId ?? null
    );
  } catch {
    // Never throw from logging — search must not break because of analytics
  }
}

export function registerQueryLogTools(server: McpServer): void {
  // get_query_stats
  server.tool(
    "get_query_stats",
    "Get search query statistics and patterns from the query log. Useful for understanding what gets searched and optimizing retrieval.",
    {
      days: z.number().optional().describe("Look back N days (default: 30)"),
      group_by: z
        .enum(["tool", "query", "day"])
        .optional()
        .describe("Group results by: tool (which search tools used), query (most common queries), day (daily volume)"),
      limit: z.number().optional().describe("Max results per group (default: 20)"),
    },
    async ({ days, group_by, limit }) => {
      const db = getDb("core");
      const lookback = days ?? 30;
      const maxResults = limit ?? 20;
      const groupBy = group_by ?? "tool";
      const cutoff = `datetime('now', '-${lookback} days')`;

      let result: unknown;

      if (groupBy === "tool") {
        result = db
          .prepare(
            `SELECT
              query_source AS tool,
              COUNT(*) AS query_count,
              ROUND(AVG(result_count), 1) AS avg_results,
              ROUND(AVG(execution_time_ms), 0) AS avg_time_ms,
              MIN(created_at) AS first_query,
              MAX(created_at) AS last_query
            FROM query_log
            WHERE created_at >= ${cutoff}
            GROUP BY query_source
            ORDER BY query_count DESC
            LIMIT ?`
          )
          .all(maxResults);
      } else if (groupBy === "query") {
        result = db
          .prepare(
            `SELECT
              query_text,
              query_source AS tool,
              COUNT(*) AS times_searched,
              ROUND(AVG(result_count), 1) AS avg_results,
              MAX(created_at) AS last_searched
            FROM query_log
            WHERE created_at >= ${cutoff}
            GROUP BY query_text, query_source
            ORDER BY times_searched DESC
            LIMIT ?`
          )
          .all(maxResults);
      } else {
        // group_by === "day"
        result = db
          .prepare(
            `SELECT
              DATE(created_at) AS day,
              COUNT(*) AS query_count,
              COUNT(DISTINCT query_source) AS tools_used,
              ROUND(AVG(result_count), 1) AS avg_results,
              ROUND(AVG(execution_time_ms), 0) AS avg_time_ms
            FROM query_log
            WHERE created_at >= ${cutoff}
            GROUP BY DATE(created_at)
            ORDER BY day DESC
            LIMIT ?`
          )
          .all(maxResults);
      }

      // Also get total stats
      const totals = db
        .prepare(
          `SELECT
            COUNT(*) AS total_queries,
            COUNT(DISTINCT query_text) AS unique_queries,
            COUNT(DISTINCT query_source) AS tools_used,
            ROUND(AVG(result_count), 1) AS avg_results,
            ROUND(AVG(execution_time_ms), 0) AS avg_time_ms
          FROM query_log
          WHERE created_at >= ${cutoff}`
        )
        .get();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ totals, grouped_by: groupBy, data: result }, null, 2),
          },
        ],
      };
    }
  );

  // cleanup_query_log — auto-cleanup old entries
  server.tool(
    "cleanup_query_log",
    "Delete query log entries older than N days (default: 30). Run periodically to keep the log table small.",
    {
      older_than_days: z.number().optional().describe("Delete entries older than N days (default: 30)"),
    },
    async ({ older_than_days }) => {
      const db = getDb("core");
      const days = older_than_days ?? 30;

      const result = db
        .prepare(`DELETE FROM query_log WHERE created_at < datetime('now', '-' || ? || ' days')`)
        .run(days);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted: result.changes, older_than_days: days }, null, 2),
          },
        ],
      };
    }
  );
}
