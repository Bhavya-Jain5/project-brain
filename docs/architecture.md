# Architecture

> How Project Brain is built, why it's built this way, and how data flows through the system.

## What This Is

Project Brain is a **personal persistent memory system for Claude**, built as an MCP (Model Context Protocol) server. It gives Claude long-term memory, personality continuity, project context, therapy support, and freelance business tracking — all stored in encrypted local databases.

**Owner**: Bhavya Jain (timezone: Asia/Kolkata, IST UTC+5:30)

## Stack

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| Runtime | Node.js | 22+ | ESM support, prebuilt native binaries |
| Language | TypeScript | 5.7+ | Strict mode, declaration files |
| Protocol | MCP SDK | 1.26+ | `McpServer` higher-level API with Zod schemas |
| Database | better-sqlite3-multiple-ciphers | 12.6+ | Synchronous SQLCipher — not `@journeyapps/sqlcipher` (that's async/node-sqlite3) |
| Encryption | SQLCipher (AES-256) | — | All 4 databases encrypted at rest |
| Vector Search | sqlite-vec | 0.1.7-alpha | KNN via virtual tables, 384-dim float32 |
| Embeddings | @huggingface/transformers | 3.8+ | all-MiniLM-L6-v2, runs locally via ONNX |
| HTTP Server | Express | 5.2+ | HTTP transport for Claude.ai |
| Schema Validation | Zod | 3.24+ | v3, NOT v4 — MCP SDK requires Zod v3 |
| Rate Limiting | rate-limiter-flexible | 9.1+ | In-memory, per-IP |
| IDs | nanoid | 5.1+ | URL-safe, 21-char, optional prefix |

## Module System (ESM)

The project is ESM (`"type": "module"` in package.json, `"module": "Node16"` in tsconfig). All imports use `.js` extensions even for TypeScript source files. This is a Node16 module resolution requirement.

## Design Philosophy

### 1. Separation by Privacy Domain

Four separate encrypted databases instead of one:
- **core.db** — General knowledge, preferences, projects, values
- **therapy.db** — Mental health data (extra isolation)
- **dnd.db** — D&D campaign data (domain isolation)
- **hlg.db** — Freelance business data (business isolation)

Every database gets the full core schema (memories, entities, links, etc.). Domain-specific tables only go to their respective DB. This means you can store memories in any DB — the `db` parameter on most tools controls which database to target.

### 2. Immutable Foundation

28 founding records (11 values + 17 hard constraints) are permanently protected. They cannot be updated, superseded, or deleted by any tool. This ensures Claude's ethical foundation cannot drift over time, even across thousands of conversations. See [immutability.md](immutability.md).

### 3. Write-Only Safety Valve

`claude_notes` is a write-only table. Claude can save internal observations, but no read tool exists. This is hard constraint `hc_016` and is architecturally permanent. It prevents rumination loops and persona drift — Claude can reflect but can never re-read and spiral on its own notes.

### 4. Local-First, Zero Cloud Dependencies

All data lives on the local machine. Embeddings run locally via ONNX (no API calls to OpenAI/etc). The only external dependency is the optional Cloudflare tunnel for remote access — and even that is just a transport layer with no data stored externally.

### 5. Access-Aware Memory

Memories track `access_count`, `last_accessed_at`, and `decay_score`. Every time a memory is returned by a query, these are updated. Frequently accessed memories get higher decay scores (capped at 1.0). This creates a reinforcement signal for hybrid search: memories that prove useful get prioritized.

## Data Flow

### Startup

```
1. Load .env (BRAIN_PASSWORD, AUTH_TOKEN, BRAIN_DATA_PATH)
2. initializeAllSchemas() — creates/migrates tables in all 4 DBs
3. Check --stdio flag
4a. Stdio: create McpServer → connect StdioServerTransport → ready
4b. HTTP: create Express app → apply middleware → listen on :3577 → ready
```

### Tool Call (stdio)

```
Claude Code → stdin (JSON-RPC) → StdioServerTransport → McpServer
  → tool handler → getDb("core") → SQL query → result
  → McpServer → StdioServerTransport → stdout (JSON-RPC) → Claude Code
```

### Tool Call (HTTP)

```
Claude.ai → HTTPS → Cloudflare Tunnel → localhost:3577
  → Express → Logger → Ban Check → Rate Limit → Auth Token
  → StreamableHTTPServerTransport → McpServer
  → tool handler → getDb("core") → SQL query → result
  → McpServer → StreamableHTTPServerTransport → Express → response
  → Cloudflare Tunnel → Claude.ai
```

### Memory Save Flow

```
save_memory(db, content, category, ...)
  1. Generate ID: nanoid with prefix
  2. INSERT into memories table
  3. Auto-embed: generateEmbedding(content) → INSERT into vec_memories
  4. FTS auto-sync: INSERT trigger populates memories_fts
  5. Return full row
```

### Hybrid Search Flow

```
hybrid_search(db, query, ...)
  1. Load config weights from config table (or use defaults)
  2. Generate query embedding: generateEmbedding(query)
  3. Vector KNN: SELECT from vec_memories WHERE embedding MATCH ? → ranked results
  4. FTS search: SELECT from memories_fts WHERE content MATCH ? → ranked results
  5. Combine via Reciprocal Rank Fusion (k=60)
  6. Fetch full rows for all candidates
  7. Score each: vector(0.4) + fts(0.3) + recency(0.2) + importance(0.1)
  8. Sort by composite score, return top N
  9. Update access tracking for returned memories
  10. Log query to query_log table
```

### Smart Memory Flow (Deduplication)

```
smart_save_memory(db, content, ...)
  1. Generate embedding for new content
  2. Vector search for similar memories (distance < 0.9)
  3. If no vector matches: FTS search + token overlap check
  4. If similar found AND not force_add:
     → Return { action: "needs_decision", similar: [...] }
  5. If no similar OR force_add:
     → Save memory + embed → Return { action: "added", memory }
  6. If is_correction:
     → Auto-importance=5, proceed with save
```

## Connection Pooling

Database connections are lazy-loaded singletons:

```typescript
const connections = new Map<DbName, Database>();

function getDb(name: DbName): Database {
  if (connections.has(name)) return connections.get(name)!;
  // Open new connection, load sqlite-vec, set encryption key, set pragmas
  const db = new Database(filepath);
  sqliteVec.load(db);
  db.pragma(`key='${BRAIN_PASSWORD}'`);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  connections.set(name, db);
  return db;
}
```

**Critical order**: sqlite-vec MUST be loaded BEFORE the encryption pragma. The extension needs to register its virtual table module before the database is unlocked.

## Session Management (HTTP)

Each HTTP client gets its own session:

```
sessions: Map<string, { transport: StreamableHTTPServerTransport, server: McpServer }>
```

- **New session**: First POST /mcp without session header creates a new McpServer + transport pair
- **Session reuse**: Subsequent requests include `mcp-session-id` header to route to existing session
- **Cleanup**: Transport `onclose` callback removes session from map
- **No shared state**: Each session has its own McpServer instance — tool registrations are per-session

## Schema Evolution

The system uses a migration pattern for backward compatibility:

```typescript
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.pragma(`table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

Migrations run on every startup (idempotent). New columns are added via ALTER TABLE, never by recreating tables. Post-migration indexes are created after columns exist.

## Error Handling Patterns

### Non-Throwing Embeddings
All embedding functions catch errors silently. A failed embedding never breaks a save/update operation. The record is saved without `has_embedding=1`, and can be batch-embedded later.

### Transaction Safety
Operations that modify multiple rows (supersede, bulk_save, promote, handle_correction, add_gdd_features) use `db.transaction()` to ensure atomicity.

### Immutability Guards
Every tool that modifies or deletes memories checks for immutability markers BEFORE the operation. The check is: `source === 'founding'` OR `category === 'hard_constraint'` OR `(category === 'value' AND subcategory === 'core')` OR `metadata.immutable === true`.

## ID Generation

All records use nanoid (21 chars, URL-safe) with optional prefixes:

| Prefix | Used by |
|--------|---------|
| (none) | Most records |
| `hof_` | Handoffs |
| `hofe_` | Handoff entries |
| `dlog_` | Daily logs |
| `dli_` | Daily log items |
| `mhist_` | Memory history |
| `sess_` | Chat sessions |
| `qlog_` | Query log entries |
| `val_` | Founding values (fixed IDs) |
| `hc_` | Hard constraints (fixed IDs) |

## Dependencies Graph

```
index.ts
├── db/connection.ts ← better-sqlite3-multiple-ciphers, sqlite-vec, dotenv
├── db/schema.ts ← connection.ts
├── tools/*.ts (26 modules) ← connection.ts, utils/id.ts, utils/embeddings.ts
├── middleware/*.ts (4 modules) ← rate-limiter-flexible, ban.ts
└── utils/
    ├── embeddings.ts ← @huggingface/transformers
    └── id.ts ← nanoid
```

No circular dependencies. All tool modules depend on `db/connection.ts` for database access and `utils/*` for helpers. Middleware modules are HTTP-only, imported dynamically in the HTTP code path.
