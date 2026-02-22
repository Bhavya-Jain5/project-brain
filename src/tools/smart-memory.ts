import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateId } from "../utils/id.js";
import { autoEmbed, generateEmbedding } from "../utils/embeddings.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

const categoryEnum = z.enum([
  "fact", "decision", "learning", "preference", "blocker",
  "observation", "personality", "value", "hard_constraint", "pattern", "action", "correction",
]);

/**
 * Simple token overlap similarity between two strings.
 * Returns 0-1 where 1 = identical tokens.
 */
function calculateSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

/**
 * Sanitize a query for FTS5.
 */
function sanitizeFtsQuery(query: string): string {
  const ftsOperators = /["\*]|AND|OR|NOT|NEAR/;
  if (ftsOperators.test(query)) return query;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '""';
  return terms.map(t => `"${t}"`).join(" ");
}

export function registerSmartMemoryTools(server: McpServer): void {
  // smart_save_memory — AUDN cycle: check for duplicates before saving
  server.tool(
    "smart_save_memory",
    "Proactive memory save with duplicate detection (AUDN cycle). Searches for similar memories first. If duplicates found, returns them for you to decide: update, supersede, or confirm new. Corrections auto-set importance=5.",
    {
      db: dbEnum.describe("Which database"),
      content: z.string().describe("The memory content to save"),
      category: categoryEnum.describe("Memory category"),
      subcategory: z.string().optional().describe("Optional subcategory"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      importance: z.number().min(1).max(5).optional().describe("Importance 1-5 (default: 3, corrections auto-set to 5)"),
      project_id: z.string().optional().describe("Link to a project entity"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence 0-1 (default: 1.0 for user-stated, 0.7-0.9 for inferred)"),
      is_correction: z.boolean().optional().describe("Set true when user is correcting a previous misunderstanding"),
      force_add: z.boolean().optional().describe("Skip similarity check and add directly"),
    },
    async ({ db: dbName, content, category, subcategory, tags, importance, project_id, confidence, is_correction, force_add }) => {
      const db = getDb(dbName as DbName);

      // Corrections always get max importance
      const effectiveImportance = (is_correction || category === "correction") ? 5 : (importance ?? 3);
      const effectiveConfidence = confidence ?? 1.0;

      // Step 1: Skip similarity check if force_add
      if (!force_add) {
        let potentialDuplicates: Array<Record<string, unknown>> = [];

        // Try vector-based duplicate detection first (catches semantic overlap)
        try {
          const queryEmbedding = await generateEmbedding(content);
          const vecResults = db.prepare(`
            SELECT m.*, v.distance FROM vec_memories v
            JOIN memories m ON m.rowid = v.rowid
            WHERE v.embedding MATCH ? AND k = 5
            ORDER BY v.distance
          `).all(queryEmbedding) as Array<Record<string, unknown> & { distance: number }>;

          // Filter: active only, distance < 0.9 (≈ cosine similarity > 0.6)
          potentialDuplicates = vecResults
            .filter(r => r.status === "active" && r.distance < 0.9)
            .map(r => ({ ...r, similarity: Math.round((1 - r.distance * r.distance / 2) * 100) / 100 }));
        } catch {
          // Vector search unavailable — fall back to FTS + token overlap
          const safeQuery = sanitizeFtsQuery(content);
          let similar: unknown[] = [];

          try {
            similar = db.prepare(`
              SELECT m.* FROM memories m
              JOIN memories_fts ON memories_fts.rowid = m.rowid
              WHERE memories_fts MATCH ? AND m.status = 'active'
              ORDER BY rank LIMIT 5
            `).all(safeQuery);
          } catch {
            similar = db.prepare(`
              SELECT * FROM memories
              WHERE content LIKE ? AND status = 'active'
              ORDER BY updated_at DESC LIMIT 5
            `).all(`%${content.slice(0, 50)}%`);
          }

          if (similar.length > 0) {
            const scored = (similar as { id: string; content: string }[]).map(mem => ({
              ...mem,
              similarity: calculateSimilarity(mem.content, content),
            }));
            potentialDuplicates = scored.filter(s => s.similarity > 0.5);
          }
        }

        if (potentialDuplicates.length > 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                action: "needs_decision",
                similar: potentialDuplicates,
                message: "Found semantically similar memories. Options: (1) use update_memory to merge, (2) use supersede_memory to replace, (3) call smart_save_memory again with force_add=true to save as new, (4) do nothing if already captured.",
                suggested_action: is_correction ? "supersede" : "review",
              }, null, 2),
            }],
          };
        }
      }

      // Step 2: No conflicts (or force_add), save the memory
      const memId = generateId("mem");
      const histId = generateId("mhist");
      const tagsJson = tags ? JSON.stringify(tags) : null;

      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO memories (id, content, category, subcategory, tags, source, project_id, importance, memory_type, confidence)
          VALUES (?, ?, ?, ?, ?, 'claude_code', ?, ?, 'permanent', ?)
        `).run(memId, content, category, subcategory ?? null, tagsJson, project_id ?? null, effectiveImportance, effectiveConfidence);

        // Log to memory history
        db.prepare(`
          INSERT INTO memory_history (id, db, memory_id, operation, content_after, reason)
          VALUES (?, ?, ?, 'created', ?, ?)
        `).run(histId, dbName, memId, content, is_correction ? "User correction" : "Proactive save");
      });

      transaction();

      const memory = db.prepare("SELECT * FROM memories WHERE id = ?").get(memId);
      autoEmbed(db, "memories", memId, content);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ action: "added", memory }, null, 2),
        }],
      };
    }
  );

  // handle_correction — special tool for user corrections
  server.tool(
    "handle_correction",
    "Handle when user corrects a misunderstanding. Finds the wrong memory, archives it, creates the correction with importance=5, and logs the change.",
    {
      db: dbEnum.describe("Which database"),
      wrong_memory_id: z.string().optional().describe("ID of the wrong memory (if known)"),
      wrong_content: z.string().optional().describe("Content of the wrong memory (used to search if ID not known)"),
      correct_content: z.string().describe("The correct information"),
      category: categoryEnum.optional().describe("Category for the correction (inherited from old if not specified)"),
      tags: z.array(z.string()).optional().describe("Tags for the correction"),
    },
    async ({ db: dbName, wrong_memory_id, wrong_content, correct_content, category, tags }) => {
      const db = getDb(dbName as DbName);

      // Step 1: Find the wrong memory
      let wrongMemory: { id: string; content: string; category: string; subcategory: string | null; tags: string | null; source: string } | undefined;

      if (wrong_memory_id) {
        wrongMemory = db.prepare("SELECT * FROM memories WHERE id = ?").get(wrong_memory_id) as typeof wrongMemory;
      } else if (wrong_content) {
        // Search for it
        const safeQuery = sanitizeFtsQuery(wrong_content);
        try {
          wrongMemory = db.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.rowid
            WHERE memories_fts MATCH ? AND m.status = 'active'
            ORDER BY rank LIMIT 1
          `).all(safeQuery)[0] as typeof wrongMemory;
        } catch {
          wrongMemory = db.prepare(`
            SELECT * FROM memories WHERE content LIKE ? AND status = 'active'
            ORDER BY updated_at DESC LIMIT 1
          `).get(`%${wrong_content.slice(0, 50)}%`) as typeof wrongMemory;
        }
      }

      // Check immutability if found
      if (wrongMemory) {
        if (wrongMemory.source === "founding") {
          return {
            content: [{ type: "text" as const, text: "BLOCKED: Cannot correct founding memories. These are immutable." }],
            isError: true,
          };
        }
      }

      const newMemId = generateId("mem");
      const histId = generateId("mhist");
      const tagsJson = tags ? JSON.stringify(tags) : (wrongMemory?.tags ?? null);
      const effectiveCategory = category ?? wrongMemory?.category ?? "correction";

      const transaction = db.transaction(() => {
        // Create correction memory (importance=5, never decays)
        db.prepare(`
          INSERT INTO memories (id, content, category, subcategory, tags, source, importance, memory_type, confidence, decay_score)
          VALUES (?, ?, ?, ?, ?, 'claude_code', 5, 'permanent', 1.0, 1.0)
        `).run(newMemId, correct_content, effectiveCategory, wrongMemory?.subcategory ?? null, tagsJson);

        if (wrongMemory) {
          // Archive the wrong memory
          db.prepare(`
            UPDATE memories SET status = 'archived', superseded_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newMemId, wrongMemory.id);

          // Create supersedes link
          const linkId = generateId("lnk");
          db.prepare(`
            INSERT OR IGNORE INTO links (id, source_type, source_id, target_type, target_id, relationship, context)
            VALUES (?, 'memory', ?, 'memory', ?, 'corrects', 'User correction')
          `).run(linkId, newMemId, wrongMemory.id);

          // Log history for the archived memory
          const archHistId = generateId("mhist");
          db.prepare(`
            INSERT INTO memory_history (id, db, memory_id, operation, content_before, reason)
            VALUES (?, ?, ?, 'corrected', ?, ?)
          `).run(archHistId, dbName, wrongMemory.id, wrongMemory.content, `Corrected to: ${correct_content}`);
        }

        // Log history for the new correction
        db.prepare(`
          INSERT INTO memory_history (id, db, memory_id, operation, content_after, content_before, reason)
          VALUES (?, ?, ?, 'created', ?, ?, 'User correction')
        `).run(histId, dbName, newMemId, correct_content, wrongMemory?.content ?? null);
      });

      transaction();

      const correctionMemory = db.prepare("SELECT * FROM memories WHERE id = ?").get(newMemId);
      autoEmbed(db, "memories", newMemId, correct_content);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            action: "corrected",
            archived_memory_id: wrongMemory?.id ?? null,
            correction_memory: correctionMemory,
          }, null, 2),
        }],
      };
    }
  );

  // get_memory_history — see change history for a memory
  server.tool(
    "get_memory_history",
    "Get the full change history of a memory (created, updated, corrected, promoted, etc.)",
    {
      memory_id: z.string().describe("Memory ID to get history for"),
    },
    async ({ memory_id }) => {
      // Search across all dbs
      const dbs: DbName[] = ["core", "therapy", "dnd", "hlg"];
      for (const dbName of dbs) {
        const db = getDb(dbName);
        const history = db.prepare(
          "SELECT * FROM memory_history WHERE memory_id = ? ORDER BY changed_at ASC"
        ).all(memory_id);
        if (history.length > 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ db: dbName, history }, null, 2) }] };
        }
      }

      return { content: [{ type: "text" as const, text: `No history found for memory '${memory_id}'` }] };
    }
  );
}
