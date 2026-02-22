import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";
import { autoEmbed } from "../utils/embeddings.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const resourceTypeEnum = z.enum([
  "article", "video", "repo", "tool", "tutorial", "asset", "documentation", "package",
]);

const statusEnum = z.enum([
  "captured", "reading", "read", "reference", "archived",
]);

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function registerResourceTools(server: McpServer): void {
  // save_resource
  server.tool(
    "save_resource",
    "Save a new resource (article, video, repo, tool, tutorial, asset, documentation, package)",
    {
      db: dbEnum.describe("Which database to save to"),
      title: z.string().describe("Resource title"),
      url: z.string().optional().describe("Resource URL"),
      resource_type: resourceTypeEnum.optional().describe("Type of resource"),
      description: z.string().optional().describe("Resource description"),
      notes: z.string().optional().describe("Personal notes about this resource"),
      key_takeaways: z.array(z.string()).optional().describe("Key takeaways from the resource"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      category: z.string().optional().describe("Category for grouping"),
      project_id: z.string().optional().describe("Link to a project entity"),
      source_memory_id: z.string().optional().describe("Link to the memory that referenced this resource"),
    },
    async ({ db: dbName, title, url, resource_type, description, notes, key_takeaways, tags, category, project_id, source_memory_id }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("res");
      const domain = url ? extractDomain(url) : null;
      const keyTakeawaysJson = key_takeaways ? JSON.stringify(key_takeaways) : null;
      const tagsJson = tags ? JSON.stringify(tags) : null;

      db.prepare(`
        INSERT INTO resources (id, db, title, url, resource_type, description, notes, key_takeaways, tags, category, project_id, source_memory_id, domain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, dbName, title, url ?? null, resource_type ?? null, description ?? null,
        notes ?? null, keyTakeawaysJson, tagsJson, category ?? null,
        project_id ?? null, source_memory_id ?? null, domain
      );

      const resource = db.prepare("SELECT * FROM resources WHERE id = ?").get(id);
      autoEmbed(db, "resources", id, [title, description, notes].filter(Boolean).join(". "));
      return { content: [{ type: "text" as const, text: JSON.stringify(resource, null, 2) }] };
    }
  );

  // get_resources
  server.tool(
    "get_resources",
    "Get resources with optional filters (type, category, tags, status, project, domain)",
    {
      db: dbEnum.describe("Which database to query"),
      resource_type: resourceTypeEnum.optional().describe("Filter by resource type"),
      category: z.string().optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by ANY of these tags"),
      status: statusEnum.optional().describe("Filter by specific status (default: all non-archived)"),
      project_id: z.string().optional().describe("Filter by project"),
      domain: z.string().optional().describe("Filter by domain (e.g. github.com)"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, resource_type, category, tags, status, project_id, domain, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (resource_type) {
        conditions.push("resource_type = ?");
        params.push(resource_type);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }
      if (status) {
        conditions.push("status = ?");
        params.push(status);
      } else {
        conditions.push("status IN ('captured', 'reading', 'read', 'reference')");
      }
      if (project_id) {
        conditions.push("project_id = ?");
        params.push(project_id);
      }
      if (domain) {
        conditions.push("domain = ?");
        params.push(domain);
      }
      if (tags && tags.length > 0) {
        const tagConditions = tags.map(() => "tags LIKE ?");
        conditions.push(`(${tagConditions.join(" OR ")})`);
        for (const tag of tags) {
          params.push(`%"${tag}"%`);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM resources ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit ?? 50, offset ?? 0);

      const resources = db.prepare(sql).all(...params) as { id: string }[];

      // Update access tracking for returned resources
      if (resources.length > 0) {
        const updateAccess = db.prepare(`
          UPDATE resources SET
            access_count = access_count + 1,
            accessed_at = datetime('now')
          WHERE id = ?
        `);
        for (const res of resources) {
          updateAccess.run(res.id);
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(resources, null, 2) }] };
    }
  );

  // update_resource
  server.tool(
    "update_resource",
    "Update an existing resource's title, url, type, description, notes, tags, status, rating, or project",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Resource ID to update"),
      title: z.string().optional().describe("New title"),
      url: z.string().optional().describe("New URL (domain will be re-extracted)"),
      resource_type: resourceTypeEnum.optional().describe("New resource type"),
      description: z.string().optional().describe("New description"),
      notes: z.string().optional().describe("New notes"),
      key_takeaways: z.array(z.string()).optional().describe("New key takeaways"),
      tags: z.array(z.string()).optional().describe("New tags"),
      category: z.string().optional().describe("New category"),
      status: statusEnum.optional().describe("New status: captured, reading, read, reference, archived"),
      quality_rating: z.number().min(1).max(5).optional().describe("Quality rating 1-5"),
      project_id: z.string().optional().describe("New project link"),
    },
    async ({ db: dbName, id, title, url, resource_type, description, notes, key_takeaways, tags, category, status, quality_rating, project_id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM resources WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Resource '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (title !== undefined) { updates.push("title = ?"); params.push(title); }
      if (url !== undefined) {
        updates.push("url = ?"); params.push(url);
        updates.push("domain = ?"); params.push(extractDomain(url));
      }
      if (resource_type !== undefined) { updates.push("resource_type = ?"); params.push(resource_type); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
      if (key_takeaways !== undefined) { updates.push("key_takeaways = ?"); params.push(JSON.stringify(key_takeaways)); }
      if (tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }
      if (category !== undefined) { updates.push("category = ?"); params.push(category); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (quality_rating !== undefined) { updates.push("quality_rating = ?"); params.push(quality_rating); }
      if (project_id !== undefined) { updates.push("project_id = ?"); params.push(project_id); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      params.push(id);

      db.prepare(`UPDATE resources SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM resources WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
