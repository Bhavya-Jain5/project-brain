import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgTaskTools(server: McpServer): void {
  // create_hlg_task
  server.tool(
    "create_hlg_task",
    "Create a granular task for an HLG project. Tasks are for feedback-phase work items or specific bugs/fixes tied to a system.",
    {
      project_id: z.string().describe("Project ID"),
      title: z.string().describe("Task title"),
      system_id: z.string().optional().describe("System this task belongs to (sys_...)"),
      description: z.string().optional().describe("Task details"),
      estimated_minutes: z.number().optional().describe("Estimated minutes"),
    },
    async ({ project_id, title, system_id, description, estimated_minutes }) => {
      const db = getDb("hlg");
      const id = generateId("task");

      db.prepare(`
        INSERT INTO hlg_tasks (id, project_id, system_id, title, description, estimated_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, project_id, system_id ?? null, title, description ?? null, estimated_minutes ?? null);

      const task = db.prepare("SELECT * FROM hlg_tasks WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  // get_hlg_tasks
  server.tool(
    "get_hlg_tasks",
    "Get tasks for an HLG project, optionally filtered by status or system",
    {
      project_id: z.string().describe("Project ID"),
      system_id: z.string().optional().describe("Filter by system ID"),
      status: z.enum(["todo", "in_progress", "done"]).optional().describe("Filter by status"),
    },
    async ({ project_id, system_id, status }) => {
      const db = getDb("hlg");
      let sql = "SELECT * FROM hlg_tasks WHERE project_id = ?";
      const params: unknown[] = [project_id];

      if (system_id) {
        sql += " AND system_id = ?";
        params.push(system_id);
      }
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      sql += " ORDER BY CASE status WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 END, created_at DESC";

      const tasks = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // update_hlg_task
  server.tool(
    "update_hlg_task",
    "Update an HLG task's details, status, or time tracking",
    {
      id: z.string().describe("Task ID (task_...)"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      status: z.enum(["todo", "in_progress", "done"]).optional().describe("New status"),
      system_id: z.string().optional().describe("Assign to system"),
      estimated_minutes: z.number().optional().describe("Updated estimate"),
      actual_minutes: z.number().optional().describe("Actual minutes spent"),
    },
    async ({ id, title, description, status, system_id, estimated_minutes, actual_minutes }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM hlg_tasks WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Task '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (title !== undefined) { updates.push("title = ?"); params.push(title); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (system_id !== undefined) { updates.push("system_id = ?"); params.push(system_id); }
      if (estimated_minutes !== undefined) { updates.push("estimated_minutes = ?"); params.push(estimated_minutes); }
      if (actual_minutes !== undefined) { updates.push("actual_minutes = ?"); params.push(actual_minutes); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE hlg_tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM hlg_tasks WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
