import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";
import { autoEmbed } from "../utils/embeddings.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const noteTypeEnum = z.enum([
  "note", "document", "gdd", "design", "retrospective", "spec", "meeting", "journal",
]);

export function registerNoteTools(server: McpServer): void {
  // save_note
  server.tool(
    "save_note",
    "Save a new note (note, document, GDD, design doc, retrospective, spec, meeting notes, journal entry)",
    {
      db: dbEnum.describe("Which database to save to"),
      title: z.string().describe("Note title"),
      content: z.string().describe("Note content"),
      note_type: noteTypeEnum.optional().describe("Note type (default: note)"),
      summary: z.string().optional().describe("Brief summary of the note"),
      key_points: z.array(z.string()).optional().describe("Key points as a list"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      category: z.string().optional().describe("Category for organization"),
      parent_note_id: z.string().optional().describe("Parent note ID for hierarchical notes"),
      project_id: z.string().optional().describe("Link to a project entity"),
      entity_id: z.string().optional().describe("Link to an entity"),
    },
    async ({ db: dbName, title, content, note_type, summary, key_points, tags, category, parent_note_id, project_id, entity_id }) => {
      const db = getDb(dbName as DbName);
      const id = generateId("note");
      const keyPointsJson = key_points ? JSON.stringify(key_points) : null;
      const tagsJson = tags ? JSON.stringify(tags) : null;
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

      db.prepare(`
        INSERT INTO notes (id, db, title, content, note_type, summary, key_points, tags, category, parent_note_id, project_id, entity_id, word_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, dbName, title, content, note_type ?? "note", summary ?? null,
        keyPointsJson, tagsJson, category ?? null, parent_note_id ?? null,
        project_id ?? null, entity_id ?? null, wordCount
      );

      const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
      autoEmbed(db, "notes", id, [title, summary ?? content].filter(Boolean).join(". "));
      return { content: [{ type: "text" as const, text: JSON.stringify(note, null, 2) }] };
    }
  );

  // get_notes
  server.tool(
    "get_notes",
    "Get notes with optional filters (type, category, tags, project, entity)",
    {
      db: dbEnum.describe("Which database to query"),
      note_type: z.string().optional().describe("Filter by note type"),
      category: z.string().optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by ANY of these tags"),
      project_id: z.string().optional().describe("Filter by project"),
      entity_id: z.string().optional().describe("Filter by entity"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ db: dbName, note_type, category, tags, project_id, entity_id, limit, offset }) => {
      const db = getDb(dbName as DbName);
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (note_type) {
        conditions.push("note_type = ?");
        params.push(note_type);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }
      if (tags && tags.length > 0) {
        const tagConditions = tags.map(() => "tags LIKE ?");
        conditions.push(`(${tagConditions.join(" OR ")})`);
        for (const tag of tags) {
          params.push(`%"${tag}"%`);
        }
      }
      if (project_id) {
        conditions.push("project_id = ?");
        params.push(project_id);
      }
      if (entity_id) {
        conditions.push("entity_id = ?");
        params.push(entity_id);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM notes ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit ?? 20, offset ?? 0);

      const notes = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(notes, null, 2) }] };
    }
  );

  // update_note
  server.tool(
    "update_note",
    "Update an existing note's title, content, type, summary, key points, tags, category, or linked IDs",
    {
      db: dbEnum.describe("Which database"),
      id: z.string().describe("Note ID to update"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New content"),
      note_type: noteTypeEnum.optional().describe("New note type"),
      summary: z.string().optional().describe("New summary"),
      key_points: z.array(z.string()).optional().describe("New key points"),
      tags: z.array(z.string()).optional().describe("New tags"),
      category: z.string().optional().describe("New category"),
      project_id: z.string().optional().describe("New project ID"),
      entity_id: z.string().optional().describe("New entity ID"),
    },
    async ({ db: dbName, id, title, content, note_type, summary, key_points, tags, category, project_id, entity_id }) => {
      const db = getDb(dbName as DbName);

      const existing = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Note '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (title !== undefined) { updates.push("title = ?"); params.push(title); }
      if (content !== undefined) {
        updates.push("content = ?"); params.push(content);
        const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
        updates.push("word_count = ?"); params.push(wordCount);
        updates.push("version = version + 1");
      }
      if (note_type !== undefined) { updates.push("note_type = ?"); params.push(note_type); }
      if (summary !== undefined) { updates.push("summary = ?"); params.push(summary); }
      if (key_points !== undefined) { updates.push("key_points = ?"); params.push(JSON.stringify(key_points)); }
      if (tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }
      if (category !== undefined) { updates.push("category = ?"); params.push(category); }
      if (project_id !== undefined) { updates.push("project_id = ?"); params.push(project_id); }
      if (entity_id !== undefined) { updates.push("entity_id = ?"); params.push(entity_id); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE notes SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}
