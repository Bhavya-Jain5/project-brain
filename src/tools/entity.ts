import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerEntityTools(server: McpServer): void {
  // create_entity
  server.tool(
    "create_entity",
    "Create a new entity (project, person, system, module, concept, etc.)",
    {
      db: dbEnum.describe("Which database"),
      name: z.string().describe("Entity name"),
      type: z.string().describe("Entity type: project, person, system, module, concept, ai_agent, etc."),
      subtype: z.string().optional().describe("Optional refinement of type"),
      description: z.string().optional().describe("Entity description"),
      tags: z.array(z.string()).optional().describe("Tags"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
    },
    async ({ db: dbName, name, type, subtype, description, tags, metadata }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("ent");
      const tagsJson = tags ? JSON.stringify(tags) : null;
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      db.prepare(`
        INSERT INTO entities (id, name, type, subtype, description, tags, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, type, subtype ?? null, description ?? null, tagsJson, metadataJson);

      const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(entity, null, 2) }] };
    }
  );

  // get_entities
  server.tool(
    "get_entities",
    "Get entities with optional filters (type, tags, status)",
    {
      db: dbEnum.describe("Which database"),
      type: z.string().optional().describe("Filter by entity type"),
      tags: z.array(z.string()).optional().describe("Filter by ANY of these tags"),
      status: z.string().optional().describe("Filter by status"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, type, tags, status, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (type) {
        conditions.push("type = ?");
        params.push(type);
      }
      if (status) {
        conditions.push("status = ?");
        params.push(status);
      } else {
        conditions.push("status = 'active'");
      }
      if (tags && tags.length > 0) {
        const tagConditions = tags.map(() => "tags LIKE ?");
        conditions.push(`(${tagConditions.join(" OR ")})`);
        for (const tag of tags) {
          params.push(`%"${tag}"%`);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM entities ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit ?? 50, offset ?? 0);

      const entities = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(entities, null, 2) }] };
    }
  );

  // update_entity
  server.tool(
    "update_entity",
    "Update an existing entity's name, description, tags, status, or metadata",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Entity ID to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      tags: z.array(z.string()).optional().describe("New tags"),
      status: z.string().optional().describe("New status"),
      metadata: z.record(z.unknown()).optional().describe("New metadata"),
    },
    async ({ db: dbName, id, name, description, tags, status, metadata }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Entity '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (metadata !== undefined) { updates.push("metadata = ?"); params.push(JSON.stringify(metadata)); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // get_entity_full
  server.tool(
    "get_entity_full",
    "Get an entity with ALL linked memories and related entities",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Entity ID"),
    },
    async ({ db: dbName, id }) => {
      const db = getDb(dbName as DbName);

      const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
      if (!entity) {
        return { content: [{ type: "text" as const, text: `Error: Entity '${id}' not found` }], isError: true };
      }

      // Get linked memories (entity is source or target)
      const linkedMemories = db.prepare(`
        SELECT DISTINCT m.* FROM memories m
        JOIN links l ON
          (l.source_type = 'memory' AND l.source_id = m.id AND l.target_type = 'entity' AND l.target_id = ?)
          OR
          (l.target_type = 'memory' AND l.target_id = m.id AND l.source_type = 'entity' AND l.source_id = ?)
        WHERE m.status = 'active'
      `).all(id, id);

      // Get memories scoped to this entity via project_id
      const projectMemories = db.prepare(
        "SELECT * FROM memories WHERE project_id = ? AND status = 'active'"
      ).all(id);

      // Get related entities
      const relatedEntities = db.prepare(`
        SELECT DISTINCT e.*, l.relationship FROM entities e
        JOIN links l ON
          (l.source_type = 'entity' AND l.source_id = e.id AND l.target_type = 'entity' AND l.target_id = ?)
          OR
          (l.target_type = 'entity' AND l.target_id = e.id AND l.source_type = 'entity' AND l.source_id = ?)
        WHERE e.status = 'active' AND e.id != ?
      `).all(id, id, id);

      // Deduplicate memories
      const memoryMap = new Map<string, unknown>();
      for (const m of [...linkedMemories, ...projectMemories] as Array<{ id: string }>) {
        memoryMap.set(m.id, m);
      }

      const result = {
        entity,
        memories: Array.from(memoryMap.values()),
        related_entities: relatedEntities,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // delete_entity
  server.tool(
    "delete_entity",
    "Delete an entity and its associated links",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Entity ID to delete"),
    },
    async ({ db: dbName, id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Entity '${id}' not found` }], isError: true };
      }

      const transaction = db.transaction(() => {
        // Remove associated links
        db.prepare(
          "DELETE FROM links WHERE (source_type = 'entity' AND source_id = ?) OR (target_type = 'entity' AND target_id = ?)"
        ).run(id, id);
        // Delete entity
        db.prepare("DELETE FROM entities WHERE id = ?").run(id);
      });

      transaction();
      return { content: [{ type: "text" as const, text: `Deleted entity '${id}' and its links` }] };
    }
  );
}
