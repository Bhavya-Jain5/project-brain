import type BetterSqlite3 from "better-sqlite3";
import { getDb, type DbName } from "./connection.js";

const CORE_SCHEMA = `
-- Memories: atomic facts, decisions, learnings, observations
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    tags TEXT,
    source TEXT DEFAULT 'claude_code',
    status TEXT DEFAULT 'active',
    superseded_by TEXT,
    project_id TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Entities: things that exist (projects, people, systems, concepts)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    subtype TEXT,
    description TEXT,
    tags TEXT,
    status TEXT DEFAULT 'active',
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Links: relationships between anything
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_type, source_id, target_type, target_id, relationship)
);

-- Pain Points: things that suck and need fixing
CREATE TABLE IF NOT EXISTS pain_points (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    context TEXT,
    severity TEXT DEFAULT 'minor',
    status TEXT DEFAULT 'open',
    resolution TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- Claude Notes: experimental self-reflection journal
CREATE TABLE IF NOT EXISTS claude_notes (
    id TEXT PRIMARY KEY,
    note TEXT NOT NULL,
    source TEXT DEFAULT 'claude_code',
    conversation_context TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Feature Requests: track ideas for new tables, tools, schema changes
CREATE TABLE IF NOT EXISTS feature_requests (
    id TEXT PRIMARY KEY,
    requested_by TEXT NOT NULL DEFAULT 'unknown',
    request_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claude_notes_source ON claude_notes(source);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_links_relationship ON links(relationship);
`;

// FTS5 tables and triggers — run separately since IF NOT EXISTS isn't supported for virtual tables
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    category,
    tags,
    content='memories',
    content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    name,
    description,
    type,
    tags,
    content='entities',
    content_rowid='rowid'
);
`;

const TRIGGERS_SCHEMA = `
-- Triggers to keep FTS in sync with memories
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, category, tags)
    VALUES (NEW.rowid, NEW.content, NEW.category, NEW.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category, tags)
    VALUES('delete', OLD.rowid, OLD.content, OLD.category, OLD.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category, tags)
    VALUES('delete', OLD.rowid, OLD.content, OLD.category, OLD.tags);
    INSERT INTO memories_fts(rowid, content, category, tags)
    VALUES (NEW.rowid, NEW.content, NEW.category, NEW.tags);
END;

-- Triggers to keep FTS in sync with entities
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
    INSERT INTO entities_fts(rowid, name, description, type, tags)
    VALUES (NEW.rowid, NEW.name, NEW.description, NEW.type, NEW.tags);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
    INSERT INTO entities_fts(entities_fts, rowid, name, description, type, tags)
    VALUES('delete', OLD.rowid, OLD.name, OLD.description, OLD.type, OLD.tags);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
    INSERT INTO entities_fts(entities_fts, rowid, name, description, type, tags)
    VALUES('delete', OLD.rowid, OLD.name, OLD.description, OLD.type, OLD.tags);
    INSERT INTO entities_fts(rowid, name, description, type, tags)
    VALUES (NEW.rowid, NEW.name, NEW.description, NEW.type, NEW.tags);
END;
`;

// Therapy-specific schema (therapy.db only)
const THERAPY_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    summary TEXT,
    patterns_identified TEXT,
    action_items TEXT,
    emotional_state TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
`;

// HLG-specific schema (hlg.db only)
const HLG_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    rate_usd REAL,
    deadline TEXT,
    gdd_summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    description TEXT,
    version TEXT DEFAULT '1.0',
    dependencies TEXT,
    config_options TEXT,
    folder_path TEXT,
    status TEXT DEFAULT 'documented',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS module_usage (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    customizations TEXT,
    issues TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
`;

function tableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName) as { name: string } | undefined;
  return !!row;
}

function triggerExists(db: BetterSqlite3.Database, triggerName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?"
  ).get(triggerName) as { name: string } | undefined;
  return !!row;
}

export function initializeSchema(dbName: DbName): void {
  const db = getDb(dbName);

  // Run core schema (all DBs get this)
  db.exec(CORE_SCHEMA);

  // FTS tables — check before creating since virtual tables can't use IF NOT EXISTS reliably on all versions
  if (!tableExists(db, "memories_fts")) {
    db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content, category, tags,
        content='memories', content_rowid='rowid'
      );
    `);
  }

  if (!tableExists(db, "entities_fts")) {
    db.exec(`
      CREATE VIRTUAL TABLE entities_fts USING fts5(
        name, description, type, tags,
        content='entities', content_rowid='rowid'
      );
    `);
  }

  // Triggers — check before creating
  if (!triggerExists(db, "memories_ai")) {
    db.exec(TRIGGERS_SCHEMA);
  }

  // Domain-specific schemas
  if (dbName === "therapy") {
    db.exec(THERAPY_SCHEMA);
  }

  if (dbName === "hlg") {
    db.exec(HLG_SCHEMA);
  }
}

export function initializeAllSchemas(): void {
  const dbNames: DbName[] = ["core", "therapy", "dnd", "hlg"];
  for (const name of dbNames) {
    initializeSchema(name);
  }
}
