# Vector Search & Hybrid Retrieval

> Embedding pipeline, hybrid search algorithm, scoring weights, batch embedding.

## Overview

Project Brain uses local embeddings for semantic search — no external API calls. The system combines vector similarity with traditional FTS, recency, and importance signals via a hybrid retrieval algorithm.

## Stack

| Component | Technology | Details |
|-----------|-----------|---------|
| Embedding model | all-MiniLM-L6-v2 | 384-dim, float32, ~90MB, Sentence Transformers |
| Runtime | @huggingface/transformers 3.8+ | ONNX runtime in Node.js |
| Vector storage | sqlite-vec 0.1.7-alpha | SQLite virtual tables for KNN search |
| Vector tables | vec0 | `vec_memories`, `vec_entities`, `vec_notes`, `vec_resources` |

## Embedding Pipeline

### Model Loading

The embedding model is **lazy-loaded** on first use:

```typescript
let pipeline: any = null;

async function getModel() {
  if (!pipeline) {
    pipeline = await HuggingFace.pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
  return pipeline;
}
```

**First call**: Downloads ~90MB model, caches locally (in HuggingFace cache directory). Subsequent calls are instant.

### Embedding Generation

```typescript
async function generateEmbedding(text: string): Promise<Buffer> {
  const model = await getModel();
  const output = await model(text, { pooling: "mean", normalize: true });
  // Convert Float32Array to Buffer (384 floats = 1536 bytes)
  return Buffer.from(output.data.buffer);
}
```

**Pooling**: Mean pooling across all tokens, L2-normalized. This produces a unit vector where cosine similarity = dot product.

**Batch mode**: `generateEmbeddings(texts)` processes multiple texts efficiently.

### Auto-Embedding

When a record is saved via `save_memory`, `create_entity`, `save_note`, or `save_resource`:

1. The record is inserted into the base table
2. `autoEmbed(db, table, id, text)` is called asynchronously
3. Embedding is generated and inserted into the corresponding vec table
4. `has_embedding` flag is set to 1

**Non-throwing**: If embedding fails (model not loaded, text too long, etc.), the record is still saved — just without an embedding. It can be batch-embedded later.

### Re-Embedding on Update

When a record's content changes:
1. Old vec entry is deleted
2. New embedding generated and inserted
3. `has_embedding` flag updated

---

## Vector Tables

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories  USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities  USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes     USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_resources USING vec0(embedding float[384]);
```

**Keying**: Vector tables use SQLite rowid to link to the base table. The rowid of a memory in `memories` is the same rowid in `vec_memories`.

**Search syntax**:
```sql
SELECT rowid, distance
FROM vec_memories
WHERE embedding MATCH ?
ORDER BY distance
LIMIT ?
```

The `?` parameter is the query embedding as a Buffer.

---

## Hybrid Search Algorithm

The `hybrid_search` tool combines four signals using Reciprocal Rank Fusion (RRF) plus direct scoring.

### Step-by-Step

1. **Load weights** — Check `weights` parameter, then config table, then defaults:
   - `vector = 0.4`
   - `fts = 0.3`
   - `recency = 0.2`
   - `importance = 0.1`

2. **Generate query embedding** — `generateEmbedding(query)`

3. **Vector search** — KNN on vec table with `k = limit * 3` (over-fetch for better fusion):
   ```sql
   SELECT rowid, distance FROM vec_{type}
   WHERE embedding MATCH ? ORDER BY distance LIMIT ?
   ```

4. **FTS search** — Full-text search on FTS5 table:
   ```sql
   SELECT rowid, rank FROM {type}_fts WHERE content MATCH ?
   ```
   Falls back to `LIKE '%query%'` if FTS returns no results.

5. **Reciprocal Rank Fusion** — Combine vector and FTS rankings:
   ```
   RRF_score(doc) = 1/(k + rank_vector) + 1/(k + rank_fts)
   ```
   Where `k = 60` (standard RRF constant). Documents found by only one method still get scored.

6. **Fetch full rows** — Get complete records for all candidate IDs.

7. **Score each result**:
   ```
   vector_score  = (1 - distance/max_distance) * vector_weight
   fts_score     = rrf_fts_component * fts_weight
   recency_score = recency_factor * recency_weight
   importance_score = (importance / max_importance) * importance_weight

   total_score = vector_score + fts_score + recency_score + importance_score
   ```

   **Recency factor**: Based on `decay_score` and age of the record. More recent + more accessed = higher.

   **Importance factor**: Normalized `importance` (for memories) or `mention_count` (for entities).

8. **Sort and return** — Top N by total score, with individual signal scores for transparency.

### Return Format

```json
{
  "results": [
    {
      "id": "mem_abc123",
      "type": "memory",
      "content": "Bhavya prefers dark mode in all apps",
      "score": 0.847,
      "signals": {
        "vector": 0.32,
        "fts": 0.22,
        "recency": 0.18,
        "importance": 0.08
      },
      "data": { /* full row */ }
    }
  ],
  "meta": {
    "total_candidates": 45,
    "returned": 20,
    "execution_time_ms": 127,
    "weights": { "vector": 0.4, "fts": 0.3, "recency": 0.2, "importance": 0.1 }
  }
}
```

The `signals` breakdown lets Claude (or a human) understand WHY a result ranked where it did.

---

## Semantic Search (Pure Vector)

The `semantic_search` tool is simpler — pure KNN with no fusion:

1. Generate query embedding
2. KNN search on vec table
3. Fetch full rows
4. Return sorted by distance (lower = more similar)

Useful when you want pure semantic similarity without keyword or freshness bias.

---

## Batch Embedding

The `batch_embed` tool pre-computes embeddings for records missing them:

1. Query records where `has_embedding = 0` (up to `limit` per type)
2. Generate embeddings in batch via `generateEmbeddings(texts)`
3. In a transaction: INSERT into vec table + UPDATE `has_embedding = 1`
4. Return counts per type

**Use cases**:
- After initial data import
- After migration adds new embedable tables
- Periodic maintenance

---

## Tuning Weights

Retrieval weights are configurable via the config table:

```
set_config(key: "retrieval.vector_weight", value: "0.5")
set_config(key: "retrieval.fts_weight", value: "0.2")
set_config(key: "retrieval.recency_weight", value: "0.2")
set_config(key: "retrieval.importance_weight", value: "0.1")
```

Weights are loaded at query time, so changes take effect immediately.

**Per-query override**: The `weights` parameter on `hybrid_search` can override config for a single query.

**Weight guidelines**:
- Higher `vector_weight`: Better for semantic/conceptual queries ("how does the auth system work?")
- Higher `fts_weight`: Better for exact-match queries (specific terms, names, IDs)
- Higher `recency_weight`: Prioritizes recent knowledge (useful for fast-moving projects)
- Higher `importance_weight`: Prioritizes high-importance memories (values, decisions)

---

## Access Tracking Integration

Both `hybrid_search` and `semantic_search` update access tracking for returned results:

```sql
UPDATE memories SET
  access_count = access_count + 1,
  last_accessed_at = datetime('now'),
  decay_score = MIN(1.0, decay_score + 0.1)
WHERE id IN (?)
```

This creates a positive feedback loop: memories that are found useful get boosted in future retrievals via the recency and importance signals.

---

## Query Logging

Both search tools call `logQuery()` internally:

```typescript
logQuery(db, queryText, "hybrid", resultCount, resultIds, executionTimeMs);
```

This populates the `query_log` table for analytics. The `get_query_stats` tool can analyze patterns: which queries are most common, which tools are used, average result counts, average execution times.

**Non-blocking**: Query logging never delays search results. Errors are silently caught.

---

## Limitations

- **Model size**: 384 dimensions is modest — good for general text, may miss fine-grained distinctions in very similar content
- **Language**: all-MiniLM-L6-v2 is English-optimized
- **Content length**: Very long texts are truncated by the model's 256-token window; only the beginning is effectively embedded
- **sqlite-vec alpha**: The sqlite-vec extension is pre-release software; edge cases may exist
- **No incremental indexing**: Batch embed must be manually triggered for records created before auto-embed was added
