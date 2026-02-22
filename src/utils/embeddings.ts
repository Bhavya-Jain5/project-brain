/**
 * Embedding generation utility using @huggingface/transformers.
 * Lazy-loads the model on first use (~90MB download, then cached).
 * Produces 384-dim float32 vectors for sqlite-vec.
 */

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMS = 384;

export const EMBEDDING_MODEL = "all-MiniLM-L6-v2";

// Lazy-loaded pipeline singleton
let extractorPromise: Promise<unknown> | null = null;

async function getExtractor(): Promise<unknown> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return await pipeline("feature-extraction", MODEL_NAME, {
        dtype: "fp32",
      });
    })();
  }
  return extractorPromise;
}

/**
 * Generate a single embedding as a Buffer ready for sqlite-vec.
 * Returns a Buffer containing 384 float32 values (1536 bytes).
 */
export async function generateEmbedding(text: string): Promise<Buffer> {
  const extractor = (await getExtractor()) as (
    input: string,
    options: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array }>;

  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Buffer.from(output.data.buffer, output.data.byteOffset, EMBEDDING_DIMS * 4);
}

/**
 * Generate embeddings for multiple texts in batch.
 * More efficient than calling generateEmbedding() repeatedly.
 */
export async function generateEmbeddings(texts: string[]): Promise<Buffer[]> {
  if (texts.length === 0) return [];

  const extractor = (await getExtractor()) as (
    input: string[],
    options: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array; dims: number[] }>;

  const output = await extractor(texts, { pooling: "mean", normalize: true });

  const buffers: Buffer[] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIMS;
    const slice = output.data.slice(start, start + EMBEDDING_DIMS);
    buffers.push(Buffer.from(slice.buffer, slice.byteOffset, EMBEDDING_DIMS * 4));
  }
  return buffers;
}

/**
 * Check if the embedding model is loaded/ready.
 */
export function isModelLoaded(): boolean {
  return extractorPromise !== null;
}

/**
 * Auto-embed a single record after save/update.
 * Non-throwing — never breaks the save operation.
 * Handles insert and re-embed (deletes old vec entry if present).
 */
export async function autoEmbed(
  db: import("better-sqlite3").Database,
  table: "memories" | "entities" | "notes" | "resources",
  id: string,
  text: string
): Promise<void> {
  try {
    if (!text || text.trim().length === 0) return;

    const vecTable = `vec_${table}`;
    const row = db.prepare(`SELECT rowid FROM ${table} WHERE id = ?`).get(id) as { rowid: number } | undefined;
    if (!row) return;

    const buffer = await generateEmbedding(text);

    // Delete existing embedding if present (for re-embedding on update)
    try {
      db.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`).run(BigInt(row.rowid));
    } catch { /* might not exist — fine */ }

    db.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (?, ?)`).run(BigInt(row.rowid), buffer);

    // Update has_embedding flag (resources may not have this column yet — catch silently)
    try {
      db.prepare(`UPDATE ${table} SET has_embedding = 1, embedding_model = ? WHERE id = ?`).run(EMBEDDING_MODEL, id);
    } catch { /* column might not exist for resources — handled by migration */ }
  } catch {
    // Never throw from auto-embed — save must not break
  }
}

/**
 * Auto-embed multiple records in batch after bulk save.
 * Non-throwing — never breaks the save operation.
 */
export async function autoEmbedBatch(
  db: import("better-sqlite3").Database,
  table: "memories" | "entities" | "notes" | "resources",
  records: Array<{ id: string; text: string }>
): Promise<void> {
  try {
    const validRecords = records.filter(r => r.text && r.text.trim().length > 0);
    if (validRecords.length === 0) return;

    const vecTable = `vec_${table}`;

    // Look up rowids
    const rowids = new Map<string, number>();
    for (const rec of validRecords) {
      const row = db.prepare(`SELECT rowid FROM ${table} WHERE id = ?`).get(rec.id) as { rowid: number } | undefined;
      if (row) rowids.set(rec.id, row.rowid);
    }

    if (rowids.size === 0) return;

    const textsToEmbed = validRecords.filter(r => rowids.has(r.id)).map(r => r.text);
    const idsToEmbed = validRecords.filter(r => rowids.has(r.id)).map(r => r.id);
    const buffers = await generateEmbeddings(textsToEmbed);

    const insertVec = db.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (?, ?)`);
    const updateFlag = db.prepare(`UPDATE ${table} SET has_embedding = 1, embedding_model = ? WHERE id = ?`);

    const transaction = db.transaction(() => {
      for (let i = 0; i < idsToEmbed.length; i++) {
        const rowid = rowids.get(idsToEmbed[i])!;
        try {
          insertVec.run(BigInt(rowid), buffers[i]);
          updateFlag.run(EMBEDDING_MODEL, idsToEmbed[i]);
        } catch { /* skip individual failures */ }
      }
    });

    transaction();
  } catch {
    // Never throw from auto-embed
  }
}
