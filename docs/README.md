# Project Brain v2 — Documentation

> **Purpose**: Give any Claude instance (Code or Chat) or developer everything needed to understand, operate, and extend the Project Brain MCP server.

## Quick Start

```bash
cd project-brain
npm run build                     # Compile TypeScript → dist/
node dist/index.js --stdio        # Claude Code (local, no auth)
node dist/index.js                # HTTP server on :3577 (full security)
node dist/seed.js                 # Load founding values (idempotent)
```

## Documentation Map

| Document | What it covers |
|----------|---------------|
| [architecture.md](architecture.md) | System overview, design philosophy, data flow, why things are the way they are |
| [database-schema.md](database-schema.md) | All 29 tables across 4 encrypted databases — columns, types, constraints, indexes, FTS, vector tables |
| [immutability.md](immutability.md) | Founding values (11), hard constraints (17), protection rules, what can never change |
| [security-transport.md](security-transport.md) | Dual transport (stdio/HTTP), middleware stack, auth, rate limiting, auto-ban, logging, session management |
| [vector-search.md](vector-search.md) | Embedding pipeline, hybrid retrieval algorithm (RRF), scoring weights, batch embedding |
| [operations.md](operations.md) | Build, deploy, backup, Cloudflare tunnel, system tray, environment setup |

### Tool Reference (79 tools across 26 modules)

| Document | Tools | Count |
|----------|-------|-------|
| [tools-core.md](tools-core.md) | Memory, Smart Memory, Entity, Link, Search, Vector Search, Query Log | 24 |
| [tools-sessions.md](tools-sessions.md) | Chat Sessions, Handoff, Context, Daily Logs | 16 |
| [tools-content.md](tools-content.md) | Resources, Notes, Templates, Summaries, Timeline | 14 |
| [tools-domain.md](tools-domain.md) | HLG Freelance, GDD Features, Therapy Sessions, Therapy Patterns | 16 |
| [tools-system.md](tools-system.md) | Config, Time, Feature Requests, Claude Notes, Personality, Pain Points | 9 |
| [handoff-system.md](handoff-system.md) | Handoff deep-dive (protocol, workflow, diagrams) | — |

**Total: 79 tools**

## Key Concepts

- **4 encrypted databases**: core.db (general), therapy.db (mental health), dnd.db (D&D), hlg.db (freelance)
- **Every DB gets the full core schema** — memories, entities, links, etc. Domain tables only go to their specific DB.
- **Immutable founding records**: 28 records (11 values + 17 constraints) can never be modified or deleted
- **Dual transport**: stdio for Claude Code (local), HTTP for Claude.ai (via Cloudflare tunnel)
- **Hybrid search**: Vector similarity (0.4) + FTS (0.3) + Recency (0.2) + Importance (0.1) — weights configurable
- **Write-only claude_notes**: Architectural safety — no read tool exists, prevents persona drift

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude Code                           │
│                    (stdio, no auth)                           │
└────────────────────────┬────────────────────────────────────┘
                         │ StdioServerTransport
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (McpServer)                     │
│                                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ Memory  │ │ Entity  │ │ Search  │ │ ... 23 more      │  │
│  │ (6)     │ │ (5)     │ │ (7)     │ │   tool modules   │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────────┬─────────┘  │
│       └───────────┴───────────┴────────────────┘             │
│                         │                                     │
│  ┌──────────────────────┴──────────────────────────────┐    │
│  │              Database Layer (SQLCipher)               │    │
│  │  ┌────────┐ ┌──────────┐ ┌───────┐ ┌───────────┐   │    │
│  │  │core.db │ │therapy.db│ │dnd.db │ │  hlg.db   │   │    │
│  │  └────────┘ └──────────┘ └───────┘ └───────────┘   │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         ▲ StreamableHTTPServerTransport
                         │
┌────────────────────────┴────────────────────────────────────┐
│              Express 5 HTTP Server (:3577)                    │
│  Logger → Ban Check → Rate Limit → Auth Token → MCP         │
└────────────────────────┬────────────────────────────────────┘
                         │ Cloudflare Tunnel
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                       Claude.ai                              │
│                 (HTTPS, authenticated)                        │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
E:\Project Second Brain\
├── project-brain/                    # Code repo (git-tracked)
│   ├── src/
│   │   ├── index.ts                  # Entry point — dual transport boot
│   │   ├── seed.ts                   # Founding values loader
│   │   ├── db/
│   │   │   ├── connection.ts         # SQLCipher connection pool + sqlite-vec
│   │   │   └── schema.ts            # All CREATE TABLE/INDEX/TRIGGER/vec0
│   │   ├── middleware/               # HTTP-only security stack
│   │   │   ├── auth.ts              # Token validation + auto-ban trigger
│   │   │   ├── ban.ts               # IP ban tracking
│   │   │   ├── logger.ts            # JSON-lines request logging
│   │   │   └── rate-limit.ts        # 100 req/min per IP
│   │   ├── tools/                    # 26 tool modules → 79 tools
│   │   └── utils/
│   │       ├── embeddings.ts         # Local HuggingFace embeddings
│   │       └── id.ts                # nanoid ID generation
│   ├── dist/                         # Compiled output
│   ├── docs/                         # This documentation
│   └── tray/                         # Windows system tray scripts
│
├── brain-data/                       # Data repo (auto-backup only, NOT git-pushed)
│   ├── dbs/                          # 4 encrypted SQLite databases
│   └── logs/                         # Security logs
│
├── FOUNDING_VALUES.sql               # 11 immutable values
├── HARD_CONSTRAINTS.sql              # 17 immutable constraints
├── PROJECT_BRAIN_ARCHITECTURE.md     # Legacy monolithic reference
└── PROJECT_BRAIN_SPEC.md             # Original design spec
```
