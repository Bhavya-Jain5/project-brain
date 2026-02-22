# Tool Reference: Core Data Tools

> Memory, Smart Memory, Entity, Link, Search, Vector Search, Query Log — 24 tools

## Memory Tools (6) — `src/tools/memory.ts`

### `save_memory`

Save a new memory (atomic fact, decision, learning, etc.).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | `core`, `therapy`, `dnd`, `hlg` |
| `content` | string | yes | — | The memory text |
| `category` | enum | yes | — | `fact`, `decision`, `learning`, `preference`, `blocker`, `observation`, `personality`, `value`, `hard_constraint`, `pattern`, `action`, `correction` |
| `subcategory` | string | no | — | Refinement of category |
| `tags` | string[] | no | — | Searchable tags |
| `project_id` | string | no | — | Associate with entity |
| `importance` | int (1–5) | no | 3 | 1=minor, 5=foundational |
| `metadata` | object | no | — | Arbitrary JSON (can include `immutable: true`) |

**Returns**: Full memory row (all columns)

**Side effects**:
- Auto-generates embedding and inserts into `vec_memories`
- FTS trigger populates `memories_fts`

**Edge cases**:
- Setting `metadata.immutable = true` makes the memory permanently protected

---

### `get_memories`

Retrieve memories with filtering.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `category` | string | no | — | Filter by category |
| `tags` | string[] | no | — | Match any tag (OR logic) |
| `project_id` | string | no | — | Filter by project |
| `status` | string | no | — | `active`, `superseded`, `archived` |
| `created_after` | string | no | — | ISO 8601 date |
| `created_before` | string | no | — | ISO 8601 date |
| `min_importance` | int | no | — | Minimum importance |
| `limit` | int | no | 50 | Max results |
| `offset` | int | no | 0 | Pagination |

**Returns**: Array of memory rows

**Side effects**:
- Updates `access_count`, `last_accessed_at`, `decay_score` for returned memories

---

### `update_memory`

Modify an existing memory.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | Memory ID |
| `content` | string | no | — | New content |
| `category` | string | no | — | — |
| `subcategory` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `status` | string | no | — | — |
| `importance` | int | no | — | — |
| `metadata` | object | no | — | — |

**Returns**: Updated memory row

**Guards**: Blocks if memory is immutable (founding, hard_constraint, core value, or `metadata.immutable`)

**Side effects**: Re-generates embedding if content changes

---

### `supersede_memory`

Replace one memory with another, preserving history.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `old_id` | string | yes | — | Memory to replace |
| `new_content` | string | yes | — | Updated content |
| `reason` | string | no | — | Why it changed |

**Returns**: `{ old_memory, new_memory, link_id }`

**Behavior**:
1. Creates new memory inheriting category, tags, importance from old
2. Marks old memory `status = 'superseded'`, sets `superseded_by`
3. Creates `supersedes` link between new → old
4. All in a transaction

**Guards**: Blocks if old memory is immutable

---

### `bulk_save_memories`

Batch save up to 100 memories in a single transaction.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `memories` | array | yes | — | Up to 100 memory objects (same fields as `save_memory`) |

**Returns**: `{ saved: number, ids: string[] }`

**Behavior**: Transaction-wrapped — all-or-nothing. Auto-embeds batch.

---

### `delete_memory`

Permanently delete a memory.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | Memory ID |

**Returns**: Deletion confirmation

**Guards**: Blocks if memory is immutable

---

## Smart Memory Tools (3) — `src/tools/smart-memory.ts`

### `smart_save_memory`

Intelligent save with deduplication detection (AUDN: Analyze, Understand, Decide, Announce).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `content` | string | yes | — | — |
| `category` | enum | yes | — | Same as `save_memory` |
| `subcategory` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `importance` | int (1–5) | no | 3 | — |
| `project_id` | string | no | — | — |
| `confidence` | float (0–1) | no | — | — |
| `is_correction` | boolean | no | false | If true, auto-importance=5 |
| `force_add` | boolean | no | false | Skip dedup check |

**Returns**: One of:
- `{ action: "needs_decision", similar: [...], message, suggested_action }` — similar memory found, Claude must decide
- `{ action: "added", memory }` — saved successfully

**Algorithm**:
1. Generate embedding for new content
2. Vector search: find memories with distance < 0.9
3. If no vector matches: FTS search + token overlap (>50% = potential dup)
4. If similar found AND not `force_add`: return `needs_decision` with similar list
5. If no similar OR `force_add`: save + embed + return `added`

---

### `handle_correction`

Correct a wrong memory — archives old, creates correction.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `wrong_memory_id` | string | no | — | ID of wrong memory (or use wrong_content) |
| `wrong_content` | string | no | — | Content to search for |
| `correct_content` | string | yes | — | The correction |
| `category` | string | no | — | Override category |
| `tags` | string[] | no | — | Override tags |

**Returns**: `{ action: "corrected", archived_memory_id, correction_memory }`

**Behavior**:
1. Find the wrong memory (by ID or content search)
2. Archive it (status → archived)
3. Create correction memory (importance=5, decay_score=1.0, category=correction)
4. Create `corrects` link
5. Log to memory_history

**Guards**: Blocks corrections to founding memories

---

### `get_memory_history`

Get the full audit trail for a memory.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `memory_id` | string | yes | — | — |

**Returns**: `{ db, history: [...] }` — all operations (created, updated, corrected, promoted)

**Behavior**: Searches across ALL databases to find the memory's history

---

## Entity Tools (5) — `src/tools/entity.ts`

### `create_entity`

Create a new entity (project, person, system, etc.).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `name` | string | yes | — | Entity name |
| `type` | enum | yes | — | `project`, `person`, `organization`, `system`, `module`, `concept`, `ai_agent`, `client` |
| `subtype` | string | no | — | — |
| `description` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `metadata` | object | no | — | — |

**Returns**: Full entity row

**Side effects**: Auto-embeds into `vec_entities`

---

### `get_entities`

Retrieve entities with filtering.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `type` | string | no | — | Filter by type |
| `tags` | string[] | no | — | Filter by tag |
| `status` | string | no | — | Default: only active |
| `limit` | int | no | 50 | — |
| `offset` | int | no | 0 | — |

**Returns**: Array of entity rows

---

### `update_entity`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |
| `name` | string | no | — | — |
| `description` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `status` | string | no | — | — |
| `metadata` | object | no | — | — |

**Returns**: Updated entity row

---

### `get_entity_full`

Get entity with all related data.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |

**Returns**: `{ entity, linked_memories, scoped_memories, related_entities }`

**Behavior**:
- `linked_memories`: memories connected via links table
- `scoped_memories`: memories with `project_id = entity.id`
- `related_entities`: entities connected via links table
- Deduplicates across linked and scoped

---

### `delete_entity`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |

**Returns**: Confirmation

**Side effects**: Cascades delete to all associated links (where entity is source or target)

---

## Link Tools (3) — `src/tools/link.ts`

### `create_link`

Create a relationship between any two entities or memories.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `source_type` | enum | yes | — | `memory`, `entity` |
| `source_id` | string | yes | — | — |
| `target_type` | enum | yes | — | `memory`, `entity` |
| `target_id` | string | yes | — | — |
| `relationship` | string | yes | — | `relates_to`, `supersedes`, `contradicts`, `depends_on`, `part_of` |
| `strength` | float (0–1) | no | 1.0 | — |
| `metadata` | object | no | — | — |

**Returns**: Full link row

**Guards**: UNIQUE constraint — catches duplicate links and returns friendly error

---

### `get_links`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `source_id` | string | no | — | Filter by source |
| `target_id` | string | no | — | Filter by target |
| `relationship` | string | no | — | Filter by type |

**Returns**: Array of links, ordered by `created_at DESC`

---

### `delete_link`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |

**Returns**: Confirmation

---

## Search Tools (2) — `src/tools/search.ts`

### `search`

Full-text search within a single database.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `query` | string | yes | — | Search query |
| `types` | string[] | no | both | `memory`, `entity` |
| `limit` | int | no | 20 | — |

**Returns**: `{ memories?: [...], entities?: [...] }`

**Behavior**:
1. Try FTS5 MATCH query first
2. If FTS returns no results: fall back to LIKE `%query%`
3. Updates access tracking for returned memories

---

### `search_all`

Full-text search across multiple databases.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | yes | — | — |
| `dbs` | string[] | no | all four | Which DBs to search |
| `limit` | int | no | 10 | Per database |

**Returns**: `{ core: { memories, entities }, therapy: { ... }, ... }`

**Behavior**: Auto-initializes schema for each DB before searching

---

## Vector Search Tools (3) — `src/tools/vector-search.ts`

See [vector-search.md](vector-search.md) for algorithm details.

### `hybrid_search`

Primary search tool — combines vector, FTS, recency, and importance signals.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `query` | string | yes | — | Natural language query |
| `types` | string[] | no | all | `memory`, `entity`, `note` |
| `limit` | int | no | 20 | — |
| `weights` | object | no | from config | `{ vector, fts, recency, importance }` |

**Returns**:
```json
{
  "results": [
    {
      "id": "mem_abc...",
      "type": "memory",
      "content": "...",
      "score": 0.85,
      "signals": { "vector": 0.32, "fts": 0.21, "recency": 0.18, "importance": 0.08 },
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

**Weight resolution**: First checks `weights` param, then config table, then defaults (0.4/0.3/0.2/0.1)

**Side effects**: Logs query to `query_log`, updates access tracking

---

### `semantic_search`

Pure vector similarity search (no FTS).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `query` | string | yes | — | — |
| `types` | string[] | no | all | `memory`, `entity`, `note` |
| `limit` | int | no | 20 | — |

**Returns**:
```json
{
  "results": [
    { "id": "mem_abc...", "type": "memory", "distance": 0.23, "data": { ... } }
  ],
  "meta": { "returned": 20, "execution_time_ms": 45 }
}
```

**Note**: Distance = L2 distance. Lower = more similar.

---

### `batch_embed`

Pre-compute embeddings for records that don't have them.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `types` | string[] | no | all | `memory`, `entity`, `note`, `resource` |
| `limit` | int | no | 100 | Max per type |

**Returns**: `{ memory: { embedded: 42, errors: 0 }, entity: { ... }, ... }`

**Behavior**:
- Fetches records with `has_embedding = 0`
- Generates embeddings in batch
- Transaction: insert into vec table + update `has_embedding` flag
- First call downloads model (~90MB)
- Non-throwing: individual failures are skipped

---

## Query Log Tools (2) — `src/tools/query-log.ts`

### `get_query_stats`

Analyze search patterns over time.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `days` | int | no | 30 | Lookback window |
| `group_by` | enum | no | — | `tool`, `query`, `day` |
| `limit` | int | no | 20 | — |

**Returns**:
```json
{
  "totals": {
    "total_queries": 234,
    "unique_queries": 87,
    "tools_used": { "hybrid": 120, "semantic": 50, "fts": 64 },
    "avg_results": 12.3,
    "avg_time_ms": 89
  },
  "grouped_by": "tool",
  "data": [...]
}
```

---

### `cleanup_query_log`

Delete old query log entries.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `older_than_days` | int | no | 30 | — |

**Returns**: `{ deleted: number, older_than_days: number }`

---

## Internal: `logQuery()` utility

Not a tool — called internally by `hybrid_search` and `semantic_search`.

```typescript
function logQuery(db, queryText, source, resultCount, resultIds, executionTimeMs, sessionId?)
```

Non-throwing: silently catches all errors. Never blocks search results.
