import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgSystemTools(server: McpServer): void {
  // create_hlg_system
  server.tool(
    "create_hlg_system",
    "Create a major system/feature being built for an HLG project. Systems are the work tracking layer — what you actually build and log time against.",
    {
      project_id: z.string().describe("Project ID"),
      name: z.string().describe("System name (e.g. 'Combo System', 'Grid Movement')"),
      description: z.string().optional().describe("What this system does"),
      estimated_hours: z.number().optional().describe("Estimated hours to build"),
      is_module_candidate: z.boolean().optional().describe("Could this become a reusable module?"),
      gdd_feature_id: z.string().optional().describe("Link to GDD feature this implements (gddf_...)"),
    },
    async ({ project_id, name, description, estimated_hours, is_module_candidate, gdd_feature_id }) => {
      const db = getDb("hlg");
      const id = generateId("sys");

      db.prepare(`
        INSERT INTO hlg_systems (id, project_id, name, description, estimated_hours, is_module_candidate, gdd_feature_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, project_id, name, description ?? null, estimated_hours ?? null, is_module_candidate ? 1 : 0, gdd_feature_id ?? null);

      const system = db.prepare("SELECT * FROM hlg_systems WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(system, null, 2) }] };
    }
  );

  // get_hlg_systems
  server.tool(
    "get_hlg_systems",
    "Get systems for an HLG project, optionally filtered by status",
    {
      project_id: z.string().describe("Project ID"),
      status: z.enum(["not_started", "in_progress", "done"]).optional().describe("Filter by status"),
    },
    async ({ project_id, status }) => {
      const db = getDb("hlg");
      let sql = "SELECT * FROM hlg_systems WHERE project_id = ?";
      const params: unknown[] = [project_id];

      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      sql += " ORDER BY CASE status WHEN 'in_progress' THEN 1 WHEN 'not_started' THEN 2 WHEN 'done' THEN 3 END, name ASC";

      const systems = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(systems, null, 2) }] };
    }
  );

  // update_hlg_system
  server.tool(
    "update_hlg_system",
    "Update an HLG system's details, status, or time tracking",
    {
      id: z.string().describe("System ID (sys_...)"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z.enum(["not_started", "in_progress", "done"]).optional().describe("New status"),
      estimated_hours: z.number().optional().describe("Updated estimate"),
      actual_hours: z.number().optional().describe("Actual hours spent"),
      is_module_candidate: z.boolean().optional().describe("Module candidate flag"),
      gdd_feature_id: z.string().optional().describe("Link to GDD feature"),
    },
    async ({ id, name, description, status, estimated_hours, actual_hours, is_module_candidate, gdd_feature_id }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM hlg_systems WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: System '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (estimated_hours !== undefined) { updates.push("estimated_hours = ?"); params.push(estimated_hours); }
      if (actual_hours !== undefined) { updates.push("actual_hours = ?"); params.push(actual_hours); }
      if (is_module_candidate !== undefined) { updates.push("is_module_candidate = ?"); params.push(is_module_candidate ? 1 : 0); }
      if (gdd_feature_id !== undefined) { updates.push("gdd_feature_id = ?"); params.push(gdd_feature_id); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE hlg_systems SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM hlg_systems WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
