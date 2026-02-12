import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const categoryEnum = z.enum([
  "fact", "decision", "learning", "preference", "blocker",
  "observation", "personality", "value", "hard_constraint", "pattern", "action",
]);

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string | null;
  source: string;
  status: string;
  superseded_by: string | null;
  project_id: string | null;
  importance: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

function isImmutable(memory: MemoryRow): boolean {
  if (memory.source === "founding") return true;
  if (memory.category === "hard_constraint") return true;
  if (memory.category === "value" && memory.subcategory === "core") return true;
  try {
    const meta = memory.metadata ? JSON.parse(memory.metadata) : null;
    if (meta?.immutable === true) return true;
  } catch { /* ignore parse errors */ }
  return false;
}

export function registerMemoryTools(server: McpServer): void {
  // save_memory
  server.tool(
    "save_memory",
    "Save a new memory (fact, decision, learning, preference, blocker, observation, etc.)",
    {
      db: dbEnum.describe("Which database to save to"),
      content: z.string().describe("The memory content"),
      category: categoryEnum.describe("Memory category"),
      subcategory: z.string().optional().describe("Optional refinement of category"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      project_id: z.string().optional().describe("Link to a project entity"),
      importance: z.number().min(1).max(5).optional().describe("Importance level 1-5 (default: 3). 5 = foundational, 1 = minor observation"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
    },
    async ({ db: dbName, content, category, subcategory, tags, project_id, importance, metadata }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("mem");
      const tagsJson = tags ? JSON.stringify(tags) : null;
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      db.prepare(`
        INSERT INTO memories (id, content, category, subcategory, tags, source, project_id, importance, metadata)
        VALUES (?, ?, ?, ?, ?, 'claude_code', ?, ?, ?)
      `).run(id, content, category, subcategory ?? null, tagsJson, project_id ?? null, importance ?? 3, metadataJson);

      const memory = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(memory, null, 2) }] };
    }
  );

  // get_memories
  server.tool(
    "get_memories",
    "Get memories with optional filters (category, tags, project, status, date range, importance)",
    {
      db: dbEnum.describe("Which database to query"),
      category: z.string().optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by ANY of these tags"),
      project_id: z.string().optional().describe("Filter by project"),
      status: z.string().optional().describe("Filter by status: active, superseded, archived (default: active)"),
      created_after: z.string().optional().describe("Only memories created after this datetime (ISO 8601, e.g. '2026-02-05' or '2026-02-05T14:30:00')"),
      created_before: z.string().optional().describe("Only memories created before this datetime (ISO 8601)"),
      min_importance: z.number().min(1).max(5).optional().describe("Minimum importance level (1-5)"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, category, tags, project_id, status, created_after, created_before, min_importance, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }
      if (project_id) {
        conditions.push("project_id = ?");
        params.push(project_id);
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
      if (created_after) {
        conditions.push("created_at >= ?");
        params.push(created_after);
      }
      if (created_before) {
        conditions.push("created_at <= ?");
        params.push(created_before);
      }
      if (min_importance) {
        conditions.push("importance >= ?");
        params.push(min_importance);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM memories ${where} ORDER BY importance DESC, updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit ?? 50, offset ?? 0);

      const memories = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(memories, null, 2) }] };
    }
  );

  // update_memory
  server.tool(
    "update_memory",
    "Update an existing memory's content, category, tags, status, or metadata",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Memory ID to update"),
      content: z.string().optional().describe("New content"),
      category: z.string().optional().describe("New category"),
      subcategory: z.string().optional().describe("New subcategory"),
      tags: z.array(z.string()).optional().describe("New tags"),
      status: z.string().optional().describe("New status: active, superseded, archived"),
      importance: z.number().min(1).max(5).optional().describe("New importance level 1-5"),
      metadata: z.record(z.unknown()).optional().describe("New metadata"),
    },
    async ({ db: dbName, id, content, category, subcategory, tags, status, importance, metadata }) => {
      const db = getDb(dbName as DbName);

      // Check if memory exists and is immutable
      const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Memory '${id}' not found` }], isError: true };
      }
      if (isImmutable(existing)) {
        return {
          content: [{ type: "text" as const, text: `BLOCKED: Cannot modify immutable memory '${id}'. Founding values and hard constraints are permanent.` }],
          isError: true,
        };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (content !== undefined) { updates.push("content = ?"); params.push(content); }
      if (category !== undefined) { updates.push("category = ?"); params.push(category); }
      if (subcategory !== undefined) { updates.push("subcategory = ?"); params.push(subcategory); }
      if (tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (importance !== undefined) { updates.push("importance = ?"); params.push(importance); }
      if (metadata !== undefined) { updates.push("metadata = ?"); params.push(JSON.stringify(metadata)); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE memories SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // supersede_memory
  server.tool(
    "supersede_memory",
    "Replace an old memory with a new one. Marks old as superseded, creates new, links them.",
    {
      db: dbEnum.describe("Which database"),
      old_id: z.string().describe("ID of the memory being superseded"),
      new_content: z.string().describe("Content for the new memory"),
      reason: z.string().optional().describe("Why this memory is being superseded"),
    },
    async ({ db: dbName, old_id, new_content, reason }) => {
      const db = getDb(dbName as DbName);

      const oldMemory = db.prepare("SELECT * FROM memories WHERE id = ?").get(old_id) as MemoryRow | undefined;
      if (!oldMemory) {
        return { content: [{ type: "text" as const, text: `Error: Memory '${old_id}' not found` }], isError: true };
      }
      if (isImmutable(oldMemory)) {
        return {
          content: [{ type: "text" as const, text: `BLOCKED: Cannot supersede immutable memory '${old_id}'. Founding values and hard constraints are permanent.` }],
          isError: true,
        };
      }

      const newId = generateId("mem");
      const linkId = generateId("lnk");

      const transaction = db.transaction(() => {
        // Create new memory (inherit category, subcategory, tags, importance from old)
        db.prepare(`
          INSERT INTO memories (id, content, category, subcategory, tags, source, project_id, importance, metadata)
          VALUES (?, ?, ?, ?, ?, 'claude_code', ?, ?, ?)
        `).run(
          newId, new_content, oldMemory.category, oldMemory.subcategory,
          oldMemory.tags, oldMemory.project_id, oldMemory.importance,
          reason ? JSON.stringify({ supersede_reason: reason }) : oldMemory.metadata
        );

        // Mark old as superseded
        db.prepare(`
          UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newId, old_id);

        // Create supersedes link
        db.prepare(`
          INSERT INTO links (id, source_type, source_id, target_type, target_id, relationship, metadata)
          VALUES (?, 'memory', ?, 'memory', ?, 'supersedes', ?)
        `).run(linkId, newId, old_id, reason ? JSON.stringify({ reason }) : null);
      });

      transaction();

      const oldUpdated = db.prepare("SELECT * FROM memories WHERE id = ?").get(old_id);
      const newMemory = db.prepare("SELECT * FROM memories WHERE id = ?").get(newId);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ old: oldUpdated, new: newMemory, link_id: linkId }, null, 2),
        }],
      };
    }
  );

  // bulk_save_memories
  server.tool(
    "bulk_save_memories",
    "Save multiple memories in a single transaction. Essential for migrations and batch imports. Returns array of created IDs.",
    {
      db: dbEnum.describe("Which database to save to"),
      memories: z.array(z.object({
        content: z.string().describe("The memory content"),
        category: categoryEnum.describe("Memory category"),
        subcategory: z.string().optional().describe("Optional refinement of category"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
        project_id: z.string().optional().describe("Link to a project entity"),
        importance: z.number().min(1).max(5).optional().describe("Importance level 1-5 (default: 3)"),
        metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
      })).min(1).max(100).describe("Array of memory objects to save (max 100)"),
    },
    async ({ db: dbName, memories: items }) => {
      const db = getDb(dbName as DbName);
      const ids: string[] = [];

      const insert = db.prepare(`
        INSERT INTO memories (id, content, category, subcategory, tags, source, project_id, importance, metadata)
        VALUES (?, ?, ?, ?, ?, 'claude_code', ?, ?, ?)
      `);

      const transaction = db.transaction(() => {
        for (const item of items) {
          const id = generateId("mem");
          ids.push(id);
          insert.run(
            id,
            item.content,
            item.category,
            item.subcategory ?? null,
            item.tags ? JSON.stringify(item.tags) : null,
            item.project_id ?? null,
            item.importance ?? 3,
            item.metadata ? JSON.stringify(item.metadata) : null,
          );
        }
      });

      transaction();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ saved: ids.length, ids }, null, 2),
        }],
      };
    }
  );

  // delete_memory
  server.tool(
    "delete_memory",
    "Delete a memory (cannot delete immutable/founding memories)",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Memory ID to delete"),
    },
    async ({ db: dbName, id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Memory '${id}' not found` }], isError: true };
      }
      if (isImmutable(existing)) {
        return {
          content: [{ type: "text" as const, text: `BLOCKED: Cannot delete immutable memory '${id}'. Founding values and hard constraints are permanent.` }],
          isError: true,
        };
      }

      db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      return { content: [{ type: "text" as const, text: `Deleted memory '${id}'` }] };
    }
  );
}
