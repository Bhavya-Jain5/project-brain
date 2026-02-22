import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, type DbName } from "../db/connection.js";
import { generateEmbedding, generateEmbeddings, EMBEDDING_MODEL } from "../utils/embeddings.js";
import { generateId } from "../utils/id.js";
import { logQuery } from "./query-log.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

interface ScoredResult {
  id: string;
  type: "memory" | "entity" | "note";
  content: string;
  score: number;
  signals: {
    vector?: number;
    fts?: number;
    recency?: number;
    importance?: number;
  };
  data: Record<string, unknown>;
}

interface MemoryRow {
  id: string;
  rowid: number;
  content: string;
  category: string;
  tags: string | null;
  importance: number;
  decay_score: number;
  status: string;
  [key: string]: unknown;
}

interface EntityRow {
  id: string;
  rowid: number;
  name: string;
  description: string | null;
  type: string;
  tags: string | null;
  mention_count: number;
  status: string;
  [key: string]: unknown;
}

interface NoteRow {
  id: string;
  rowid: number;
  title: string;
  content: string;
  summary: string | null;
  tags: string | null;
  [key: string]: unknown;
}

interface VecResult {
  rowid: number;
  distance: number;
}

const DEFAULT_WEIGHTS = {
  vector: 0.4,
  fts: 0.3,
  recency: 0.2,
  importance: 0.1,
};

const RRF_K = 60; // Standard RRF constant

function sanitizeFtsQuery(query: string): string {
  const ftsOperators = /["\*]|AND|OR|NOT|NEAR/;
  if (ftsOperators.test(query)) return query;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(" ");
}

function getTextForEmbedding(type: "memory" | "entity" | "note", row: Record<string, unknown>): string {
  switch (type) {
    case "memory":
      return String(row.content ?? "");
    case "entity":
      return [row.name, row.description].filter(Boolean).join(". ");
    case "note":
      return [row.title, row.summary ?? row.content].filter(Boolean).join(". ");
  }
}

export function registerVectorSearchTools(server: McpServer): void {
  // hybrid_search — main hybrid retrieval tool
  server.tool(
    "hybrid_search",
    "Hybrid search combining vector similarity, full-text search, recency, and importance. Best for finding semantically relevant results even with paraphrased queries.",
    {
      db: dbEnum.describe("Which database to search"),
      query: z.string().describe("Search query (natural language)"),
      types: z
        .array(z.enum(["memory", "entity", "note"]))
        .optional()
        .describe("What to search (default: memory only)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      weights: z
        .object({
          vector: z.number().optional(),
          fts: z.number().optional(),
          recency: z.number().optional(),
          importance: z.number().optional(),
        })
        .optional()
        .describe("Override default weights (vector=0.4, fts=0.3, recency=0.2, importance=0.1)"),
    },
    async ({ db: dbName, query, types, limit, weights }) => {
      const startTime = Date.now();
      const db = getDb(dbName as DbName);
      const searchTypes = types ?? ["memory"];
      const maxResults = limit ?? 20;
      const w = { ...DEFAULT_WEIGHTS, ...weights };
      const knnLimit = maxResults * 3; // Fetch more candidates for fusion

      // Load config overrides if available
      try {
        const configWeights = db
          .prepare("SELECT key, value FROM config WHERE key LIKE 'retrieval.%'")
          .all() as { key: string; value: string }[];
        for (const row of configWeights) {
          const field = row.key.replace("retrieval.", "").replace("_weight", "") as keyof typeof w;
          if (field in w && !weights?.[field]) {
            w[field] = parseFloat(row.value);
          }
        }
      } catch {
        // Config table might not have retrieval keys yet — use defaults
      }

      // Generate query embedding
      let queryBuffer: Buffer;
      try {
        queryBuffer = await generateEmbedding(query);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error generating embedding: ${msg}. Try running batch_embed first to download the model.` }],
          isError: true,
        };
      }

      const allResults: ScoredResult[] = [];

      for (const searchType of searchTypes) {
        const vecTable = `vec_${searchType === "memory" ? "memories" : searchType === "entity" ? "entities" : "notes"}`;
        const baseTable = searchType === "memory" ? "memories" : searchType === "entity" ? "entities" : "notes";
        const ftsTable = searchType === "memory" ? "memories_fts" : searchType === "entity" ? "entities_fts" : "notes_fts";

        // 1. Vector search — KNN on vec table
        const vectorResults = new Map<number, number>(); // rowid → rank
        try {
          const vecRows = db
            .prepare(`SELECT rowid, distance FROM ${vecTable} WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
            .all(queryBuffer, knnLimit) as VecResult[];
          vecRows.forEach((row, idx) => vectorResults.set(Number(row.rowid), idx + 1));
        } catch {
          // Vec table might be empty — continue with FTS only
        }

        // 2. FTS search
        const ftsResults = new Map<number, number>(); // rowid → rank
        const safeQuery = sanitizeFtsQuery(query);
        try {
          let ftsRows: { rowid: number }[];
          if (searchType === "memory") {
            ftsRows = db.prepare(`SELECT m.rowid FROM ${baseTable} m JOIN ${ftsTable} ON ${ftsTable}.rowid = m.rowid WHERE ${ftsTable} MATCH ? AND m.status = 'active' ORDER BY rank LIMIT ?`).all(safeQuery, knnLimit) as { rowid: number }[];
          } else if (searchType === "entity") {
            ftsRows = db.prepare(`SELECT e.rowid FROM ${baseTable} e JOIN ${ftsTable} ON ${ftsTable}.rowid = e.rowid WHERE ${ftsTable} MATCH ? AND e.status = 'active' ORDER BY rank LIMIT ?`).all(safeQuery, knnLimit) as { rowid: number }[];
          } else {
            ftsRows = db.prepare(`SELECT n.rowid FROM ${baseTable} n JOIN ${ftsTable} ON ${ftsTable}.rowid = n.rowid WHERE ${ftsTable} MATCH ? ORDER BY rank LIMIT ?`).all(safeQuery, knnLimit) as { rowid: number }[];
          }
          ftsRows.forEach((row, idx) => ftsResults.set(row.rowid, idx + 1));
        } catch {
          // FTS might fail — fall back to LIKE
          try {
            let likeRows: { rowid: number }[];
            if (searchType === "memory") {
              likeRows = db.prepare(`SELECT rowid FROM ${baseTable} WHERE (content LIKE ? OR tags LIKE ?) AND status = 'active' ORDER BY updated_at DESC LIMIT ?`).all(`%${query}%`, `%${query}%`, knnLimit) as { rowid: number }[];
            } else if (searchType === "entity") {
              likeRows = db.prepare(`SELECT rowid FROM ${baseTable} WHERE (name LIKE ? OR description LIKE ?) AND status = 'active' ORDER BY updated_at DESC LIMIT ?`).all(`%${query}%`, `%${query}%`, knnLimit) as { rowid: number }[];
            } else {
              likeRows = db.prepare(`SELECT rowid FROM ${baseTable} WHERE (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?`).all(`%${query}%`, `%${query}%`, knnLimit) as { rowid: number }[];
            }
            likeRows.forEach((row, idx) => ftsResults.set(row.rowid, idx + 1));
          } catch {
            // Skip
          }
        }

        // 3. Collect all candidate rowids
        const candidateRowids = new Set([...vectorResults.keys(), ...ftsResults.keys()]);

        if (candidateRowids.size === 0) continue;

        // 4. Fetch full rows for candidates
        const rowidList = [...candidateRowids].join(",");
        const rows = db.prepare(`SELECT *, rowid FROM ${baseTable} WHERE rowid IN (${rowidList})`).all() as Record<string, unknown>[];

        // 5. Score each candidate
        for (const row of rows) {
          const rowid = row.rowid as number;
          const vectorRank = vectorResults.get(rowid);
          const ftsRank = ftsResults.get(rowid);

          // RRF scores for ranked signals
          const vectorScore = vectorRank ? w.vector / (RRF_K + vectorRank) : 0;
          const ftsScore = ftsRank ? w.fts / (RRF_K + ftsRank) : 0;

          // Direct scores for recency and importance
          const decayScore = (row.decay_score as number) ?? 1.0;
          const recencyScore = w.recency * decayScore;

          const imp = (row.importance as number) ?? (row.mention_count as number) ?? 3;
          const importanceScore = w.importance * (imp / 5.0);

          const finalScore = vectorScore + ftsScore + recencyScore + importanceScore;

          // Filter: only include active records
          if (searchType === "memory" && row.status !== "active") continue;
          if (searchType === "entity" && row.status !== "active") continue;

          allResults.push({
            id: row.id as string,
            type: searchType,
            content: getTextForEmbedding(searchType, row),
            score: Math.round(finalScore * 10000) / 10000,
            signals: {
              vector: vectorRank ? Math.round(vectorScore * 10000) / 10000 : undefined,
              fts: ftsRank ? Math.round(ftsScore * 10000) / 10000 : undefined,
              recency: Math.round(recencyScore * 10000) / 10000,
              importance: Math.round(importanceScore * 10000) / 10000,
            },
            data: row,
          });
        }
      }

      // Sort by score descending, take top N
      allResults.sort((a, b) => b.score - a.score);
      const topResults = allResults.slice(0, maxResults);

      // Access tracking for returned memories
      const memoryIds = topResults.filter((r) => r.type === "memory").map((r) => r.id);
      if (memoryIds.length > 0) {
        const updateAccess = db.prepare(`
          UPDATE memories SET
            access_count = access_count + 1,
            last_accessed_at = datetime('now'),
            decay_score = MIN(1.0, COALESCE(decay_score, 1.0) + 0.1)
          WHERE id = ?
        `);
        for (const id of memoryIds) {
          updateAccess.run(id);
        }
      }

      const elapsed = Date.now() - startTime;

      // Log query
      logQuery(db, {
        db: dbName,
        queryText: query,
        querySource: "hybrid_search",
        resultCount: topResults.length,
        resultIds: topResults.map((r) => r.id),
        executionTimeMs: elapsed,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                results: topResults,
                meta: {
                  total_candidates: allResults.length,
                  returned: topResults.length,
                  execution_time_ms: elapsed,
                  weights: w,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // semantic_search — pure vector search (no FTS)
  server.tool(
    "semantic_search",
    "Pure semantic/vector search — finds results by meaning, not keywords. Good for paraphrased queries or finding conceptually similar content.",
    {
      db: dbEnum.describe("Which database to search"),
      query: z.string().describe("Search query (natural language)"),
      types: z
        .array(z.enum(["memory", "entity", "note"]))
        .optional()
        .describe("What to search (default: memory only)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ db: dbName, query, types, limit }) => {
      const startTime = Date.now();
      const db = getDb(dbName as DbName);
      const searchTypes = types ?? ["memory"];
      const maxResults = limit ?? 20;

      let queryBuffer: Buffer;
      try {
        queryBuffer = await generateEmbedding(query);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error generating embedding: ${msg}` }],
          isError: true,
        };
      }

      const results: Array<{ id: string; type: string; distance: number; data: Record<string, unknown> }> = [];

      for (const searchType of searchTypes) {
        const vecTable = `vec_${searchType === "memory" ? "memories" : searchType === "entity" ? "entities" : "notes"}`;
        const baseTable = searchType === "memory" ? "memories" : searchType === "entity" ? "entities" : "notes";

        try {
          let joinSql: string;
          if (searchType === "memory") {
            joinSql = `SELECT t.*, v.distance FROM ${vecTable} v JOIN ${baseTable} t ON t.rowid = v.rowid WHERE v.embedding MATCH ? AND k = ? AND t.status = 'active' ORDER BY v.distance`;
          } else if (searchType === "entity") {
            joinSql = `SELECT t.*, v.distance FROM ${vecTable} v JOIN ${baseTable} t ON t.rowid = v.rowid WHERE v.embedding MATCH ? AND k = ? AND t.status = 'active' ORDER BY v.distance`;
          } else {
            joinSql = `SELECT t.*, v.distance FROM ${vecTable} v JOIN ${baseTable} t ON t.rowid = v.rowid WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance`;
          }

          const rows = db.prepare(joinSql).all(queryBuffer, maxResults) as Array<Record<string, unknown> & { distance: number }>;

          for (const row of rows) {
            results.push({
              id: row.id as string,
              type: searchType,
              distance: Math.round(row.distance * 10000) / 10000,
              data: row,
            });
          }
        } catch {
          // Vec table might be empty
        }
      }

      // Sort by distance ascending (closer = more similar)
      results.sort((a, b) => a.distance - b.distance);
      const topResults = results.slice(0, maxResults);

      // Access tracking
      const memoryIds = topResults.filter((r) => r.type === "memory").map((r) => r.id);
      if (memoryIds.length > 0) {
        const updateAccess = db.prepare(`
          UPDATE memories SET
            access_count = access_count + 1,
            last_accessed_at = datetime('now'),
            decay_score = MIN(1.0, COALESCE(decay_score, 1.0) + 0.1)
          WHERE id = ?
        `);
        for (const id of memoryIds) {
          updateAccess.run(id);
        }
      }

      const elapsed = Date.now() - startTime;

      logQuery(db, {
        db: dbName,
        queryText: query,
        querySource: "semantic_search",
        resultCount: topResults.length,
        resultIds: topResults.map((r) => r.id),
        executionTimeMs: elapsed,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                results: topResults,
                meta: { returned: topResults.length, execution_time_ms: elapsed },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // batch_embed — batch embed existing records
  server.tool(
    "batch_embed",
    "Generate embeddings for existing records that don't have them yet. Run this to enable vector/hybrid search. First call downloads the model (~90MB).",
    {
      db: dbEnum.describe("Which database to process"),
      types: z
        .array(z.enum(["memory", "entity", "note", "resource"]))
        .optional()
        .describe("What to embed (default: all types)"),
      limit: z.number().optional().describe("Max records to embed per type (default: 100)"),
    },
    async ({ db: dbName, types, limit }) => {
      const db = getDb(dbName as DbName);
      const embedTypes = types ?? ["memory", "entity", "note", "resource"];
      const batchLimit = limit ?? 100;
      const results: Record<string, { embedded: number; errors: number }> = {};

      for (const embedType of embedTypes) {
        const baseTable = embedType === "memory" ? "memories" : embedType === "entity" ? "entities" : embedType === "note" ? "notes" : "resources";
        const vecTable = `vec_${baseTable}`;
        let embedded = 0;
        let errors = 0;

        // Get records without embeddings
        let rows: Array<Record<string, unknown>>;
        if (embedType === "memory") {
          rows = db
            .prepare(`SELECT id, rowid, content FROM ${baseTable} WHERE has_embedding = 0 AND status = 'active' LIMIT ?`)
            .all(batchLimit) as Array<Record<string, unknown>>;
        } else if (embedType === "entity") {
          rows = db
            .prepare(`SELECT id, rowid, name, description FROM ${baseTable} WHERE has_embedding = 0 AND status = 'active' LIMIT ?`)
            .all(batchLimit) as Array<Record<string, unknown>>;
        } else if (embedType === "note") {
          rows = db
            .prepare(`SELECT id, rowid, title, content, summary FROM ${baseTable} WHERE has_embedding = 0 LIMIT ?`)
            .all(batchLimit) as Array<Record<string, unknown>>;
        } else {
          rows = db
            .prepare(`SELECT id, rowid, title, description, notes FROM ${baseTable} WHERE has_embedding = 0 AND status != 'archived' LIMIT ?`)
            .all(batchLimit) as Array<Record<string, unknown>>;
        }

        if (rows.length === 0) {
          results[embedType] = { embedded: 0, errors: 0 };
          continue;
        }

        // Prepare texts for embedding
        const texts = rows.map((row) => {
          if (embedType === "memory") return String(row.content ?? "");
          if (embedType === "entity") return [row.name, row.description].filter(Boolean).join(". ");
          if (embedType === "note") return [row.title, row.summary ?? row.content].filter(Boolean).join(". ");
          // resource
          return [row.title, row.description, row.notes].filter(Boolean).join(". ");
        });

        // Generate embeddings in batch
        let buffers: Buffer[];
        try {
          buffers = await generateEmbeddings(texts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results[embedType] = { embedded: 0, errors: rows.length };
          continue;
        }

        // Insert into vec table and update has_embedding flag
        const insertVec = db.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (?, ?)`);
        const updateFlag = db.prepare(`UPDATE ${baseTable} SET has_embedding = 1, embedding_model = ? WHERE id = ?`);

        const transaction = db.transaction(() => {
          for (let i = 0; i < rows.length; i++) {
            try {
              const rowid = rows[i].rowid as number;
              insertVec.run(BigInt(rowid), buffers[i]);
              updateFlag.run(EMBEDDING_MODEL, rows[i].id);
              embedded++;
            } catch {
              errors++;
            }
          }
        });

        transaction();
        results[embedType] = { embedded, errors };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );
}
