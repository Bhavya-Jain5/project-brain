import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgTools(server: McpServer): void {
  // create_project
  server.tool(
    "create_hlg_project",
    "Create a new HLG freelance project",
    {
      name: z.string().describe("Project name"),
      rate_usd: z.number().optional().describe("Rate in USD"),
      deadline: z.string().optional().describe("Deadline (ISO date)"),
      gdd_summary: z.string().optional().describe("Game Design Document summary"),
    },
    async ({ name, rate_usd, deadline, gdd_summary }) => {
      const db = getDb("hlg");
      const id = generateId("proj");

      db.prepare(`
        INSERT INTO projects (id, name, rate_usd, deadline, gdd_summary)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, name, rate_usd ?? null, deadline ?? null, gdd_summary ?? null);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    }
  );

  // get_projects
  server.tool(
    "get_hlg_projects",
    "Get HLG freelance projects, optionally filtered by status",
    {
      status: z.string().optional().describe("Filter by status: active, paused, completed, archived"),
    },
    async ({ status }) => {
      const db = getDb("hlg");
      let sql = "SELECT * FROM projects";
      const params: unknown[] = [];

      if (status) {
        sql += " WHERE status = ?";
        params.push(status);
      }
      sql += " ORDER BY updated_at DESC";

      const projects = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }] };
    }
  );

  // update_project
  server.tool(
    "update_hlg_project",
    "Update an HLG project's details",
    {
      id: z.string().describe("Project ID"),
      name: z.string().optional().describe("New name"),
      status: z.string().optional().describe("New status"),
      rate_usd: z.number().optional().describe("New rate"),
      deadline: z.string().optional().describe("New deadline"),
      gdd_summary: z.string().optional().describe("Updated GDD summary"),
    },
    async ({ id, name, status, rate_usd, deadline, gdd_summary }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Project '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (rate_usd !== undefined) { updates.push("rate_usd = ?"); params.push(rate_usd); }
      if (deadline !== undefined) { updates.push("deadline = ?"); params.push(deadline); }
      if (gdd_summary !== undefined) { updates.push("gdd_summary = ?"); params.push(gdd_summary); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // register_module
  server.tool(
    "register_module",
    "Register a reusable Unity module in the HLG module library",
    {
      name: z.string().describe("Module name (unique)"),
      category: z.enum(["core", "game_feel", "ui", "meta"]).describe("Module category"),
      description: z.string().optional().describe("Module description"),
      dependencies: z.array(z.string()).optional().describe("Module dependencies (names)"),
      config_options: z.record(z.unknown()).optional().describe("Configuration options"),
      folder_path: z.string().optional().describe("Path to module folder"),
    },
    async ({ name, category, description, dependencies, config_options, folder_path }) => {
      const db = getDb("hlg");
      const id = generateId("mod");

      try {
        db.prepare(`
          INSERT INTO modules (id, name, category, description, dependencies, config_options, folder_path)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, name, category,
          description ?? null,
          dependencies ? JSON.stringify(dependencies) : null,
          config_options ? JSON.stringify(config_options) : null,
          folder_path ?? null,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE constraint")) {
          return { content: [{ type: "text" as const, text: `Module '${name}' already exists` }], isError: true };
        }
        throw err;
      }

      const module = db.prepare("SELECT * FROM modules WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(module, null, 2) }] };
    }
  );

  // log_module_usage
  server.tool(
    "log_module_usage",
    "Log usage of a module in a project, including customizations and issues",
    {
      module_id: z.string().describe("Module ID"),
      project_id: z.string().describe("Project ID"),
      customizations: z.string().optional().describe("What was customized"),
      issues: z.string().optional().describe("Any issues encountered"),
    },
    async ({ module_id, project_id, customizations, issues }) => {
      const db = getDb("hlg");
      const id = generateId("mu");

      db.prepare(`
        INSERT INTO module_usage (id, module_id, project_id, customizations, issues)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, module_id, project_id, customizations ?? null, issues ?? null);

      const usage = db.prepare("SELECT * FROM module_usage WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(usage, null, 2) }] };
    }
  );
}
