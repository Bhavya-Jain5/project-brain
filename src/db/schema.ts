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
    importance INTEGER DEFAULT 3,
    memory_type TEXT DEFAULT 'permanent',
    last_accessed_at TEXT,
    access_count INTEGER DEFAULT 0,
    valid_from TEXT,
    valid_until TEXT,
    decay_score REAL DEFAULT 1.0,
    confidence REAL DEFAULT 1.0,
    has_embedding INTEGER DEFAULT 0,
    embedding_model TEXT,
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
    aliases TEXT,
    status TEXT DEFAULT 'active',
    mention_count INTEGER DEFAULT 0,
    first_mentioned TEXT,
    last_mentioned TEXT,
    has_embedding INTEGER DEFAULT 0,
    embedding_model TEXT,
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
    context TEXT,
    bidirectional INTEGER DEFAULT 0,
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

-- Handoffs: context bridge between Chat (decision layer) and Code (implementation layer)
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    project TEXT,
    chat_last_seen INTEGER DEFAULT 0,
    code_last_seen INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS handoff_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    handoff_id TEXT NOT NULL REFERENCES handoffs(id),
    from_client TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Daily Logs: ephemeral capture layer (one row per day per db)
CREATE TABLE IF NOT EXISTS daily_logs (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    log_date TEXT NOT NULL,
    summary TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(db, log_date)
);

-- Daily Log Items: individual items within a daily log
CREATE TABLE IF NOT EXISTS daily_log_items (
    id TEXT PRIMARY KEY,
    daily_log_id TEXT NOT NULL REFERENCES daily_logs(id),
    content TEXT NOT NULL,
    item_type TEXT DEFAULT 'observation',
    importance REAL DEFAULT 5.0,
    status TEXT DEFAULT 'pending',
    promoted_to_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Memory History: audit trail for memory changes
CREATE TABLE IF NOT EXISTS memory_history (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    content_before TEXT,
    content_after TEXT,
    reason TEXT,
    changed_at TEXT DEFAULT (datetime('now'))
);

-- Chat Sessions: conversation tracking (separate from therapy sessions)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    key_decisions TEXT,
    key_facts TEXT,
    project_id TEXT,
    message_count INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT DEFAULT 'active'
);

-- Resources: URLs, links, references captured from conversations
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    resource_type TEXT,
    description TEXT,
    notes TEXT,
    key_takeaways TEXT,
    tags TEXT,
    category TEXT,
    status TEXT DEFAULT 'captured',
    quality_rating INTEGER,
    project_id TEXT,
    source_memory_id TEXT,
    domain TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    accessed_at TEXT,
    access_count INTEGER DEFAULT 0
);

-- Notes: long-form content (design docs, retrospectives, specs)
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    note_type TEXT DEFAULT 'note',
    summary TEXT,
    key_points TEXT,
    tags TEXT,
    category TEXT,
    parent_note_id TEXT,
    version INTEGER DEFAULT 1,
    previous_version_id TEXT,
    project_id TEXT,
    entity_id TEXT,
    word_count INTEGER,
    has_embedding INTEGER DEFAULT 0,
    embedding_model TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Timeline Events: calendar-like events with dates
CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT,
    event_date TEXT NOT NULL,
    end_date TEXT,
    is_all_day INTEGER DEFAULT 1,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    is_recurring INTEGER DEFAULT 0,
    recurrence_rule TEXT,
    status TEXT DEFAULT 'upcoming',
    completed_at TEXT,
    importance REAL DEFAULT 5.0,
    project_id TEXT,
    entity_id TEXT,
    memory_id TEXT,
    reminder_before TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Summaries: auto-generated rollups (daily, weekly, monthly, project, topic)
CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    summary_type TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    project_id TEXT,
    topic TEXT,
    title TEXT,
    content TEXT NOT NULL,
    source_memory_ids TEXT,
    source_session_ids TEXT,
    memory_count INTEGER,
    completeness REAL,
    needs_review INTEGER DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now')),
    generated_by TEXT DEFAULT 'claude'
);

-- Config: tunable parameters for retrieval, decay, and system behavior
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Templates: reusable content templates
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT,
    description TEXT,
    content TEXT NOT NULL,
    template_type TEXT,
    category TEXT,
    tags TEXT,
    use_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(db, name)
);

-- Query Log: passive logging of search queries for analytics
CREATE TABLE IF NOT EXISTS query_log (
    id TEXT PRIMARY KEY,
    db TEXT NOT NULL,
    query_text TEXT NOT NULL,
    query_source TEXT,
    result_count INTEGER,
    result_ids TEXT,
    execution_time_ms INTEGER,
    session_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Coordination: multi-CC worker coordination system
CREATE TABLE IF NOT EXISTS coordination_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coordination_workers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    worker_name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'idle',
    current_task TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES coordination_sessions(id),
    UNIQUE(session_id, worker_name)
);

CREATE TABLE IF NOT EXISTS coordination_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    content TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES coordination_sessions(id)
);

-- Indexes for tables that never need migration (stable columns)
CREATE INDEX IF NOT EXISTS idx_coord_workers_session ON coordination_workers(session_id);
CREATE INDEX IF NOT EXISTS idx_coord_messages_session ON coordination_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_coord_messages_to ON coordination_messages(to_id, read_at);
CREATE INDEX IF NOT EXISTS idx_coord_sessions_status ON coordination_sessions(status);
CREATE INDEX IF NOT EXISTS idx_handoff_entries_handoff ON handoff_entries(handoff_id);
CREATE INDEX IF NOT EXISTS idx_query_log_created ON query_log(created_at);
CREATE INDEX IF NOT EXISTS idx_query_log_source ON query_log(query_source);
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
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(db, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_log_items_log ON daily_log_items(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_items_status ON daily_log_items(status);
CREATE INDEX IF NOT EXISTS idx_daily_log_items_importance ON daily_log_items(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_history_memory ON memory_history(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_history_operation ON memory_history(operation);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(db, status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_started ON chat_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_domain ON resources(domain);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
CREATE INDEX IF NOT EXISTS idx_resources_project ON resources(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_note_id);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_events(event_date);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_status ON timeline_events(status);
CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id);
CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);
CREATE INDEX IF NOT EXISTS idx_summaries_period ON summaries(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(db, name);
CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(template_type);
`;

// Indexes that depend on migrated columns — run AFTER migrations
const POST_MIGRATION_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities(mention_count DESC);
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

-- Patterns: behavioral patterns identified during therapy/reflection
CREATE TABLE IF NOT EXISTS patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern_type TEXT,
    triggers TEXT,
    manifestations TEXT,
    underlying_need TEXT,
    impact_positive TEXT,
    impact_negative TEXT,
    affected_relationships TEXT,
    status TEXT DEFAULT 'active',
    awareness_level TEXT DEFAULT 'identified',
    first_identified_at TEXT,
    last_triggered_at TEXT,
    trigger_count INTEGER DEFAULT 0,
    coping_strategies TEXT,
    source_session_id TEXT,
    related_memory_ids TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Coping Strategies: what works (and doesn't) for different patterns
CREATE TABLE IF NOT EXISTS coping_strategies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    strategy_type TEXT,
    target_patterns TEXT,
    target_emotions TEXT,
    target_situations TEXT,
    steps TEXT,
    time_required TEXT,
    effectiveness_rating REAL,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    what_helps TEXT,
    what_hinders TEXT,
    variations TEXT,
    source TEXT,
    learned_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
CREATE INDEX IF NOT EXISTS idx_coping_type ON coping_strategies(strategy_type);
CREATE INDEX IF NOT EXISTS idx_coping_effectiveness ON coping_strategies(effectiveness_rating DESC);
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

-- GDD Features: features extracted from Game Design Documents
CREATE TABLE IF NOT EXISTS gdd_features (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'planned',
    coverage_module_id TEXT,
    coverage_percentage REAL DEFAULT 0.0,
    implementation_notes TEXT,
    estimated_hours REAL,
    actual_hours REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Module Versions: version history for Unity modules
CREATE TABLE IF NOT EXISTS module_versions (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    version TEXT NOT NULL,
    version_type TEXT DEFAULT 'patch',
    unity_min_version TEXT,
    unity_max_version TEXT,
    changelog TEXT,
    breaking_changes TEXT,
    migration_notes TEXT,
    is_stable INTEGER DEFAULT 0,
    known_issues TEXT,
    git_tag TEXT,
    git_commit TEXT,
    released_at TEXT DEFAULT (datetime('now')),
    released_by TEXT,
    UNIQUE(module_id, version)
);

-- Module Dependencies: relational dependency graph
CREATE TABLE IF NOT EXISTS module_dependencies (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    depends_on_module_id TEXT NOT NULL,
    dependency_type TEXT DEFAULT 'required',
    min_version TEXT,
    max_version TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(module_id, depends_on_module_id)
);

-- Project Modules: enhanced junction between projects and modules
CREATE TABLE IF NOT EXISTS project_modules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    module_version TEXT,
    locked_version INTEGER DEFAULT 0,
    integration_status TEXT DEFAULT 'planned',
    customization_level TEXT DEFAULT 'none',
    customization_notes TEXT,
    custom_namespace TEXT,
    issues_encountered TEXT,
    workarounds_applied TEXT,
    integration_hours REAL,
    added_at TEXT DEFAULT (datetime('now')),
    integrated_at TEXT,
    removed_at TEXT,
    UNIQUE(project_id, module_id)
);

-- HLG Systems: major systems/features being built (work tracking layer)
CREATE TABLE IF NOT EXISTS hlg_systems (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'not_started',
    estimated_hours REAL,
    actual_hours REAL DEFAULT 0,
    is_module_candidate INTEGER DEFAULT 0,
    gdd_feature_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (gdd_feature_id) REFERENCES gdd_features(id)
);

-- HLG Tasks: granular work items (feedback phase)
CREATE TABLE IF NOT EXISTS hlg_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    system_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    estimated_minutes INTEGER,
    actual_minutes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (system_id) REFERENCES hlg_systems(id)
);

-- HLG Work Sessions: time-logged work entries
CREATE TABLE IF NOT EXISTS hlg_work_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    system_id TEXT,
    task_id TEXT,
    duration_minutes INTEGER,
    summary TEXT NOT NULL,
    blockers TEXT,
    decisions_summary TEXT,
    next_steps TEXT,
    logged_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (system_id) REFERENCES hlg_systems(id),
    FOREIGN KEY (task_id) REFERENCES hlg_tasks(id)
);

-- HLG Bootstrap Files: reusable project setup templates
CREATE TABLE IF NOT EXISTS hlg_bootstrap_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gdd_features_project ON gdd_features(project_id);
CREATE INDEX IF NOT EXISTS idx_gdd_features_status ON gdd_features(status);
CREATE INDEX IF NOT EXISTS idx_module_versions_module ON module_versions(module_id);
CREATE INDEX IF NOT EXISTS idx_module_deps_module ON module_dependencies(module_id);
CREATE INDEX IF NOT EXISTS idx_module_deps_depends ON module_dependencies(depends_on_module_id);
CREATE INDEX IF NOT EXISTS idx_project_modules_project ON project_modules(project_id);
CREATE INDEX IF NOT EXISTS idx_project_modules_module ON project_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_hlg_systems_project ON hlg_systems(project_id);
CREATE INDEX IF NOT EXISTS idx_hlg_systems_status ON hlg_systems(status);
CREATE INDEX IF NOT EXISTS idx_hlg_tasks_project ON hlg_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_hlg_tasks_system ON hlg_tasks(system_id);
CREATE INDEX IF NOT EXISTS idx_hlg_tasks_status ON hlg_tasks(status);
CREATE INDEX IF NOT EXISTS idx_hlg_work_sessions_project ON hlg_work_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_hlg_work_sessions_logged ON hlg_work_sessions(logged_at);
CREATE INDEX IF NOT EXISTS idx_hlg_bootstrap_active ON hlg_bootstrap_files(is_active);

CREATE TABLE IF NOT EXISTS hlg_feature_requests (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    context TEXT,
    status TEXT DEFAULT 'pending',
    rejection_reason TEXT,
    implemented_tool TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hlg_fr_status ON hlg_feature_requests(status);
`;

// HLG post-migration indexes (depend on migrated columns)
const HLG_POST_MIGRATION_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_payment ON projects(payment_status);
CREATE INDEX IF NOT EXISTS idx_modules_maturity ON modules(maturity);
`;

function columnExists(db: BetterSqlite3.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as { name: string }[];
  return columns.some(c => c.name === columnName);
}

function addColumnIfMissing(db: BetterSqlite3.Database, table: string, column: string, definition: string): void {
  if (tableExists(db, table) && !columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(db: BetterSqlite3.Database): void {
  // === Memories table migrations ===
  addColumnIfMissing(db, "memories", "importance", "INTEGER DEFAULT 3");
  addColumnIfMissing(db, "memories", "memory_type", "TEXT DEFAULT 'permanent'");
  addColumnIfMissing(db, "memories", "last_accessed_at", "TEXT");
  addColumnIfMissing(db, "memories", "access_count", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "valid_from", "TEXT");
  addColumnIfMissing(db, "memories", "valid_until", "TEXT");
  addColumnIfMissing(db, "memories", "decay_score", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "memories", "confidence", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "memories", "has_embedding", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "embedding_model", "TEXT");

  // === Entities table migrations ===
  addColumnIfMissing(db, "entities", "aliases", "TEXT");
  addColumnIfMissing(db, "entities", "mention_count", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "entities", "first_mentioned", "TEXT");
  addColumnIfMissing(db, "entities", "last_mentioned", "TEXT");
  addColumnIfMissing(db, "entities", "has_embedding", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "entities", "embedding_model", "TEXT");

  // === Resources table migrations ===
  addColumnIfMissing(db, "resources", "has_embedding", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "resources", "embedding_model", "TEXT");

  // === Links table migrations ===
  addColumnIfMissing(db, "links", "context", "TEXT");
  addColumnIfMissing(db, "links", "bidirectional", "INTEGER DEFAULT 0");

  // === HLG Projects table migrations (only runs if table exists) ===
  addColumnIfMissing(db, "projects", "client_id", "TEXT");
  addColumnIfMissing(db, "projects", "start_date", "TEXT");
  addColumnIfMissing(db, "projects", "actual_end_date", "TEXT");
  addColumnIfMissing(db, "projects", "payment_status", "TEXT DEFAULT 'unpaid'");
  addColumnIfMissing(db, "projects", "payment_date", "TEXT");
  addColumnIfMissing(db, "projects", "invoice_number", "TEXT");
  addColumnIfMissing(db, "projects", "hours_estimated", "REAL");
  addColumnIfMissing(db, "projects", "hours_tracked", "REAL DEFAULT 0");
  addColumnIfMissing(db, "projects", "repository_url", "TEXT");
  addColumnIfMissing(db, "projects", "build_url", "TEXT");
  addColumnIfMissing(db, "projects", "drive_folder", "TEXT");
  addColumnIfMissing(db, "projects", "phase", "TEXT");

  // === HLG Modules table migrations (only runs if table exists) ===
  addColumnIfMissing(db, "modules", "current_version", "TEXT");
  addColumnIfMissing(db, "modules", "unity_min_version", "TEXT");
  addColumnIfMissing(db, "modules", "maturity", "TEXT DEFAULT 'alpha'");
  addColumnIfMissing(db, "modules", "namespace", "TEXT");
  addColumnIfMissing(db, "modules", "main_class", "TEXT");
  addColumnIfMissing(db, "modules", "source_path", "TEXT");
  addColumnIfMissing(db, "modules", "tags", "TEXT");
  addColumnIfMissing(db, "modules", "api_summary", "TEXT");
  addColumnIfMissing(db, "modules", "setup_instructions", "TEXT");
  addColumnIfMissing(db, "modules", "known_issues", "TEXT");
  addColumnIfMissing(db, "modules", "changelog", "TEXT");
  addColumnIfMissing(db, "modules", "package_name", "TEXT");
  addColumnIfMissing(db, "modules", "public_url", "TEXT");
}

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

  // Run migrations for existing databases (adds new columns)
  runMigrations(db);

  // Create indexes that depend on migrated columns
  db.exec(POST_MIGRATION_INDEXES);

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

  // Daily log items FTS
  if (!tableExists(db, "daily_log_items_fts")) {
    db.exec(`
      CREATE VIRTUAL TABLE daily_log_items_fts USING fts5(
        content,
        content='daily_log_items', content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);
  }

  // Notes FTS
  if (!tableExists(db, "notes_fts")) {
    db.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title, content, summary, tags,
        content='notes', content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);
  }

  // Triggers — check before creating
  if (!triggerExists(db, "memories_ai")) {
    db.exec(TRIGGERS_SCHEMA);
  }

  // Daily log items FTS triggers
  if (!triggerExists(db, "daily_log_items_fts_ai")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS daily_log_items_fts_ai AFTER INSERT ON daily_log_items BEGIN
          INSERT INTO daily_log_items_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
      CREATE TRIGGER IF NOT EXISTS daily_log_items_fts_ad AFTER DELETE ON daily_log_items BEGIN
          INSERT INTO daily_log_items_fts(daily_log_items_fts, rowid, content)
          VALUES('delete', OLD.rowid, OLD.content);
      END;
      CREATE TRIGGER IF NOT EXISTS daily_log_items_fts_au AFTER UPDATE ON daily_log_items BEGIN
          INSERT INTO daily_log_items_fts(daily_log_items_fts, rowid, content)
          VALUES('delete', OLD.rowid, OLD.content);
          INSERT INTO daily_log_items_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  }

  // Notes FTS triggers
  if (!triggerExists(db, "notes_fts_ai")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content, summary, tags)
          VALUES (NEW.rowid, NEW.title, NEW.content, NEW.summary, NEW.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, summary, tags)
          VALUES('delete', OLD.rowid, OLD.title, OLD.content, OLD.summary, OLD.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, summary, tags)
          VALUES('delete', OLD.rowid, OLD.title, OLD.content, OLD.summary, OLD.tags);
          INSERT INTO notes_fts(rowid, title, content, summary, tags)
          VALUES (NEW.rowid, NEW.title, NEW.content, NEW.summary, NEW.tags);
      END;
    `);
  }

  // Vector search tables (sqlite-vec) — vec0 virtual tables for KNN search
  if (!tableExists(db, "vec_memories")) {
    db.exec(`CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[384])`);
  }
  if (!tableExists(db, "vec_entities")) {
    db.exec(`CREATE VIRTUAL TABLE vec_entities USING vec0(embedding float[384])`);
  }
  if (!tableExists(db, "vec_notes")) {
    db.exec(`CREATE VIRTUAL TABLE vec_notes USING vec0(embedding float[384])`);
  }
  if (!tableExists(db, "vec_resources")) {
    db.exec(`CREATE VIRTUAL TABLE vec_resources USING vec0(embedding float[384])`);
  }

  // Domain-specific schemas
  if (dbName === "therapy") {
    db.exec(THERAPY_SCHEMA);
  }

  if (dbName === "hlg") {
    db.exec(HLG_SCHEMA);
    db.exec(HLG_POST_MIGRATION_INDEXES);
  }
}

export function initializeAllSchemas(): void {
  const dbNames: DbName[] = ["core", "therapy", "dnd", "hlg"];
  for (const name of dbNames) {
    initializeSchema(name);
  }
}
