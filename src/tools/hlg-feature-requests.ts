import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

function getRequestedBy(): string {
  return process.argv.includes("--stdio") ? "code" : "chat";
}

export function registerHlgFeatureRequestTools(server: McpServer): void {
  // ── request_hlg_feature ──────────────────────────
  server.tool(
    "request_hlg_feature",
    "Submit a feature request for the HLG module (new tables, tools, workflows, etc.). Separate from core Project Brain feature requests.",
    {
      title: z.string().describe("Short title for the feature request"),
      description: z.string().describe("Detailed description of what you want added or changed"),
      context: z.string().optional().describe("What triggered this request — conversation context, pain point, etc."),
    },
    async ({ title, description, context }) => {
      const db = getDb("hlg");
      const id = generateId("hfr");
      const requested_by = getRequestedBy();

      db.prepare(`
        INSERT INTO hlg_feature_requests (id, title, description, requested_by, context)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, title, description, requested_by, context ?? null);

      const row = db.prepare("SELECT * FROM hlg_feature_requests WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] };
    }
  );

  // ── get_hlg_feature_requests ─────────────────────
  server.tool(
    "get_hlg_feature_requests",
    "List HLG module feature requests, optionally filtered by status.",
    {
      status: z.enum(["pending", "building", "done", "rejected"]).optional().describe("Filter by status"),
    },
    async ({ status }) => {
      const db = getDb("hlg");
      let sql = "SELECT * FROM hlg_feature_requests";
      const params: unknown[] = [];

      if (status) {
        sql += " WHERE status = ?";
        params.push(status);
      }

      sql += " ORDER BY created_at DESC";

      const rows = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ── update_hlg_feature_request ───────────────────
  server.tool(
    "update_hlg_feature_request",
    "Update an HLG feature request's status, rejection reason, or link to implemented tool.",
    {
      id: z.string().describe("Feature request ID (hfr_...)"),
      status: z.enum(["pending", "building", "done", "rejected"]).optional().describe("New status"),
      rejection_reason: z.string().optional().describe("Why this request was rejected"),
      implemented_tool: z.string().optional().describe("Tool name that was built to fulfill this request"),
    },
    async ({ id, status, rejection_reason, implemented_tool }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM hlg_feature_requests WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Feature request '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (rejection_reason !== undefined) { updates.push("rejection_reason = ?"); params.push(rejection_reason); }
      if (implemented_tool !== undefined) { updates.push("implemented_tool = ?"); params.push(implemented_tool); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE hlg_feature_requests SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM hlg_feature_requests WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
