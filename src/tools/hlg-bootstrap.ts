import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgBootstrapTools(server: McpServer): void {
  // add_bootstrap_file
  server.tool(
    "add_bootstrap_file",
    "Add a reusable bootstrap file template. These are files that get created when bootstrapping a new HLG project (CLAUDE.md, scripts, configs, etc).",
    {
      filename: z.string().describe("Filename (e.g. 'CLAUDE.md', 'setup.sh')"),
      file_path: z.string().describe("Relative path in project (e.g. './', 'Scripts/')"),
      content: z.string().describe("File content (can use {{PROJECT_NAME}} placeholder)"),
      file_type: z.string().describe("File type: md, sh, cs, json, yaml, txt, etc."),
    },
    async ({ filename, file_path, content, file_type }) => {
      const db = getDb("hlg");
      const id = generateId("bsf");

      db.prepare(`
        INSERT INTO hlg_bootstrap_files (id, filename, file_path, content, file_type)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, filename, file_path, content, file_type);

      const file = db.prepare("SELECT * FROM hlg_bootstrap_files WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(file, null, 2) }] };
    }
  );

  // get_bootstrap_files
  server.tool(
    "get_bootstrap_files",
    "Get all bootstrap file templates, optionally only active ones",
    {
      active_only: z.boolean().optional().describe("Only return active files (default: true)"),
    },
    async ({ active_only }) => {
      const db = getDb("hlg");
      const showActive = active_only !== false;

      let sql = "SELECT * FROM hlg_bootstrap_files";
      if (showActive) sql += " WHERE is_active = 1";
      sql += " ORDER BY file_path, filename";

      const files = db.prepare(sql).all();
      return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
    }
  );

  // update_bootstrap_file
  server.tool(
    "update_bootstrap_file",
    "Update a bootstrap file template's content or metadata",
    {
      id: z.string().describe("Bootstrap file ID (bsf_...)"),
      filename: z.string().optional().describe("New filename"),
      file_path: z.string().optional().describe("New relative path"),
      content: z.string().optional().describe("New content"),
      file_type: z.string().optional().describe("New file type"),
      is_active: z.boolean().optional().describe("Active/inactive toggle"),
    },
    async ({ id, filename, file_path, content, file_type, is_active }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM hlg_bootstrap_files WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Bootstrap file '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (filename !== undefined) { updates.push("filename = ?"); params.push(filename); }
      if (file_path !== undefined) { updates.push("file_path = ?"); params.push(file_path); }
      if (content !== undefined) { updates.push("content = ?"); params.push(content); }
      if (file_type !== undefined) { updates.push("file_type = ?"); params.push(file_type); }
      if (is_active !== undefined) { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE hlg_bootstrap_files SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM hlg_bootstrap_files WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // remove_bootstrap_file
  server.tool(
    "remove_bootstrap_file",
    "Delete a bootstrap file template permanently",
    {
      id: z.string().describe("Bootstrap file ID (bsf_...)"),
    },
    async ({ id }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM hlg_bootstrap_files WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Bootstrap file '${id}' not found` }], isError: true };
      }

      db.prepare("DELETE FROM hlg_bootstrap_files WHERE id = ?").run(id);
      return { content: [{ type: "text" as const, text: `Deleted bootstrap file '${id}'` }] };
    }
  );

  // bootstrap_hlg_project
  server.tool(
    "bootstrap_hlg_project",
    "Returns all active bootstrap files with their content, ready for Claude Code to create in the project directory. Use {{PROJECT_NAME}} placeholder in content — it gets replaced with the project name.",
    {
      project_name: z.string().describe("Project name (replaces {{PROJECT_NAME}} in templates)"),
    },
    async ({ project_name }) => {
      const db = getDb("hlg");

      const files = db.prepare(
        "SELECT * FROM hlg_bootstrap_files WHERE is_active = 1 ORDER BY file_path, filename"
      ).all() as Record<string, unknown>[];

      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: "No active bootstrap files found. Add some with add_bootstrap_file first." }] };
      }

      const result = files.map(f => ({
        filename: f.filename,
        file_path: f.file_path,
        file_type: f.file_type,
        content: (f.content as string).replace(/\{\{PROJECT_NAME\}\}/g, project_name),
      }));

      const output = {
        warning: "Only create files that don't already exist — NEVER overwrite existing files. Check for file existence before writing each file.",
        files: result,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
}
