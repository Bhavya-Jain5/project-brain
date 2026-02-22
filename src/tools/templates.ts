import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const templateTypeEnum = z.enum(["message", "document", "code", "prompt", "workflow"]);

export function registerTemplateTools(server: McpServer): void {
  // save_template
  server.tool(
    "save_template",
    "Save a new template (message, document, code, prompt, workflow) with markdown content and {{placeholders}}",
    {
      db: dbEnum.describe("Which database to save to"),
      name: z.string().describe("Unique template name (per db)"),
      content: z.string().describe("Template content (markdown with {{placeholders}})"),
      title: z.string().optional().describe("Human-readable title"),
      description: z.string().optional().describe("What this template is for"),
      template_type: templateTypeEnum.optional().describe("Template type: message, document, code, prompt, workflow"),
      category: z.string().optional().describe("Category for organization"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ db: dbName, name, content, title, description, template_type, category, tags }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("tmpl");
      const tagsJson = tags ? JSON.stringify(tags) : null;

      try {
        db.prepare(`
          INSERT INTO templates (id, db, name, title, description, content, template_type, category, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, dbName, name, title ?? null, description ?? null, content, template_type ?? null, category ?? null, tagsJson);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
          return {
            content: [{ type: "text" as const, text: `Error: Template '${name}' already exists in ${dbName}` }],
            isError: true,
          };
        }
        throw err;
      }

      const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(template, null, 2) }] };
    }
  );

  // get_templates
  server.tool(
    "get_templates",
    "Get templates with optional filters (type, category, name)",
    {
      db: dbEnum.describe("Which database to query"),
      template_type: templateTypeEnum.optional().describe("Filter by template type"),
      category: z.string().optional().describe("Filter by category"),
      name: z.string().optional().describe("Filter by exact name"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ db: dbName, template_type, category, name, limit }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = ["db = ?"];
      const params: unknown[] = [dbName];

      if (template_type) {
        conditions.push("template_type = ?");
        params.push(template_type);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }
      if (name) {
        conditions.push("name = ?");
        params.push(name);
      }

      const where = `WHERE ${conditions.join(" AND ")}`;
      const sql = `SELECT * FROM templates ${where} ORDER BY use_count DESC, updated_at DESC LIMIT ?`;
      params.push(limit ?? 20);

      const templates = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(templates, null, 2) }] };
    }
  );

  // use_template
  server.tool(
    "use_template",
    "Get a template by name and increment its use_count. Returns the template content for rendering.",
    {
      db: dbEnum.describe("Which database"),
      name: z.string().describe("Template name to look up"),
    },
    async ({ db: dbName, name }) => {
      const db = getDb(dbName as DbName);

      const template = db.prepare(
        "SELECT * FROM templates WHERE db = ? AND name = ?"
      ).get(dbName, name);

      if (!template) {
        return {
          content: [{ type: "text" as const, text: `Error: Template '${name}' not found in ${dbName}` }],
          isError: true,
        };
      }

      db.prepare(`
        UPDATE templates SET use_count = use_count + 1, last_used_at = datetime('now'), updated_at = datetime('now')
        WHERE db = ? AND name = ?
      `).run(dbName, name);

      const updated = db.prepare(
        "SELECT * FROM templates WHERE db = ? AND name = ?"
      ).get(dbName, name);

      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
