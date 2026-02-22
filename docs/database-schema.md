# Database Schema Reference

> Complete schema for all 29 tables across 4 encrypted SQLite databases.

## Database Layout

| Database | Purpose | Special Tables | Location |
|----------|---------|----------------|----------|
| `core.db` | General knowledge, personality, values, constraints | All core tables + config + query_log | `brain-data/dbs/core.db` |
| `therapy.db` | Mental health sessions and patterns | `sessions`, `patterns`, `coping_strategies` | `brain-data/dbs/therapy.db` |
| `dnd.db` | D&D campaign data | None (core schema only) | `brain-data/dbs/dnd.db` |
| `hlg.db` | Freelance projects and Unity modules | `projects`, `modules`, `module_usage`, `gdd_features`, `module_versions`, `module_dependencies`, `project_modules` | `brain-data/dbs/hlg.db` |

Every database gets the full core schema. Domain-specific tables are added only to their respective DBs.

## Connection Settings

```sql
PRAGMA key = '<BRAIN_PASSWORD>';      -- AES-256 encryption
PRAGMA journal_mode = WAL;            -- Write-Ahead Logging
PRAGMA foreign_keys = ON;             -- Referential integrity
PRAGMA busy_timeout = 5000;           -- 5s retry on lock
```

**Critical**: `sqlite-vec` extension must be loaded BEFORE the encryption pragma.

---

## Core Schema (All Databases)

### `memories`

The fundamental unit of knowledge. Every fact, decision, value, constraint, learning, and observation.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid, sometimes prefixed |
| `content` | TEXT NOT NULL | — | The memory text |
| `category` | TEXT NOT NULL | — | `fact`, `decision`, `learning`, `preference`, `blocker`, `observation`, `personality`, `value`, `hard_constraint`, `pattern`, `action`, `correction` |
| `subcategory` | TEXT | — | Refinement (e.g., `core` for values) |
| `tags` | TEXT | — | JSON array: `'["tag1","tag2"]'` |
| `source` | TEXT | `'claude_code'` | `founding`, `claude_code`, `claude_ai` |
| `status` | TEXT | `'active'` | `active`, `superseded`, `archived` |
| `superseded_by` | TEXT | — | ID of replacement memory |
| `project_id` | TEXT | — | Soft FK to entities.id |
| `importance` | INTEGER | 3 | 1 (minor) – 5 (foundational) |
| `memory_type` | TEXT | `'permanent'` | `permanent`, `temporal`, `contextual` |
| `last_accessed_at` | TEXT | — | ISO 8601, updated on retrieval |
| `access_count` | INTEGER | 0 | Incremented on retrieval |
| `valid_from` | TEXT | — | Temporal window start |
| `valid_until` | TEXT | — | Temporal window end |
| `decay_score` | REAL | 1.0 | 0.0–1.0, boosted +0.1 on access (capped) |
| `confidence` | REAL | 1.0 | 0.0–1.0, certainty level |
| `has_embedding` | INTEGER | 0 | 1 when vector-embedded |
| `embedding_model` | TEXT | — | e.g., `all-MiniLM-L6-v2` |
| `metadata` | TEXT | — | JSON object: `{"immutable":true}` |
| `created_at` | TEXT | `datetime('now')` | ISO 8601 |
| `updated_at` | TEXT | `datetime('now')` | ISO 8601 |

**Indexes**: `category`, `project_id`, `status`, `source`, `importance DESC`, `created_at DESC`, `memory_type`, `decay_score DESC`, `last_accessed_at DESC`

**FTS**: `memories_fts` — content, category, tags (FTS5, content-sync triggers)

**Vector**: `vec_memories` — 384-dim float32 embeddings

**Access tracking**: `get_memories`, `search`, `hybrid_search`, `semantic_search` all increment `access_count`, update `last_accessed_at`, and boost `decay_score` by 0.1 (capped at 1.0).

---

### `entities`

Projects, people, organizations, systems, concepts, AI agents, clients.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `name` | TEXT NOT NULL | — | Entity name |
| `type` | TEXT NOT NULL | — | `project`, `person`, `organization`, `system`, `module`, `concept`, `ai_agent`, `client` |
| `subtype` | TEXT | — | Refinement |
| `description` | TEXT | — | Long description |
| `tags` | TEXT | — | JSON array |
| `aliases` | TEXT | — | Alternative names (JSON) |
| `status` | TEXT | `'active'` | `active`, `archived`, `paused` |
| `mention_count` | INTEGER | 0 | How many times referenced |
| `first_mentioned` | TEXT | — | ISO 8601 |
| `last_mentioned` | TEXT | — | ISO 8601 |
| `has_embedding` | INTEGER | 0 | — |
| `embedding_model` | TEXT | — | — |
| `metadata` | TEXT | — | JSON object |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Indexes**: `type`, `status`, `mention_count`

**FTS**: `entities_fts` — name, description, type, tags

**Vector**: `vec_entities` — 384-dim

---

### `links`

Relationships between any two entities or memories.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `source_type` | TEXT NOT NULL | — | `memory`, `entity` |
| `source_id` | TEXT NOT NULL | — | ID of source |
| `target_type` | TEXT NOT NULL | — | `memory`, `entity` |
| `target_id` | TEXT NOT NULL | — | ID of target |
| `relationship` | TEXT NOT NULL | — | `relates_to`, `supersedes`, `contradicts`, `depends_on`, `part_of` |
| `strength` | REAL | 1.0 | 0.0–1.0 |
| `context` | TEXT | — | Explanation |
| `bidirectional` | INTEGER | 0 | 1 if mutual |
| `metadata` | TEXT | — | JSON |
| `created_at` | TEXT | `datetime('now')` | — |

**Unique constraint**: `(source_type, source_id, target_type, target_id, relationship)`

**Indexes**: `(source_type, source_id)`, `(target_type, target_id)`, `relationship`

---

### `pain_points`

Issues and frustrations needing resolution.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `description` | TEXT NOT NULL | — | What's broken |
| `context` | TEXT | — | When/where |
| `severity` | TEXT | `'minor'` | `minor`, `annoying`, `major`, `critical` |
| `status` | TEXT | `'open'` | `open`, `fixing`, `fixed`, `wont_fix` |
| `resolution` | TEXT | — | How fixed |
| `created_at` | TEXT | `datetime('now')` | — |
| `resolved_at` | TEXT | — | When fixed |

---

### `claude_notes`

Self-reflection journal. **WRITE-ONLY** — no read tool exists (hard constraint hc_016).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `note` | TEXT NOT NULL | — | Internal observation |
| `source` | TEXT | `'claude_code'` | Which Claude wrote it |
| `conversation_context` | TEXT | — | What triggered the note |
| `created_at` | TEXT | `datetime('now')` | — |

---

### `feature_requests`

Ideas for new tools or schema changes.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `requested_by` | TEXT | `'unknown'` | Who suggested it |
| `request_type` | TEXT NOT NULL | — | `new_table`, `new_tool`, `new_database`, `schema_change`, `other` |
| `description` | TEXT NOT NULL | — | What's being requested |
| `created_at` | TEXT | `datetime('now')` | — |

---

### `handoffs`

Context bridge between Claude Chat and Claude Code.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `hof_` prefix |
| `title` | TEXT NOT NULL | — | Session name |
| `project` | TEXT | — | Optional tag |
| `chat_last_seen` | INTEGER | 0 | Last entry seq Chat has seen |
| `code_last_seen` | INTEGER | 0 | Last entry seq Code has seen |
| `status` | TEXT | `'active'` | `active`, `completed`, `archived` |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | — | — |

### `handoff_entries`

Individual messages in a handoff.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `seq` | INTEGER PK | AUTOINCREMENT | Global sequence number |
| `handoff_id` | TEXT NOT NULL | — | FK → handoffs(id) |
| `from_client` | TEXT NOT NULL | — | `chat` or `code` |
| `type` | TEXT NOT NULL | — | `context`, `task`, `progress`, `question`, `decision`, `done` |
| `content` | TEXT NOT NULL | — | Message body |
| `created_at` | TEXT | `datetime('now')` | — |

**Index**: `handoff_id`

---

### `daily_logs`

One log per day per database. Ephemeral capture layer.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `dlog_` prefix |
| `db` | TEXT NOT NULL | — | Database name |
| `log_date` | TEXT NOT NULL | — | YYYY-MM-DD |
| `summary` | TEXT | — | Day summary |
| `status` | TEXT | `'active'` | `active`, `archived`, `promoted` |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Unique constraint**: `(db, log_date)`

**Index**: `(db, log_date DESC)`

### `daily_log_items`

Individual items within a daily log.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `dli_` prefix |
| `daily_log_id` | TEXT NOT NULL | — | FK → daily_logs(id) |
| `content` | TEXT NOT NULL | — | Item content |
| `item_type` | TEXT | `'observation'` | `observation`, `idea`, `decision`, `task`, `question`, `correction` |
| `importance` | REAL | 5.0 | 1–10 scale |
| `status` | TEXT | `'pending'` | `pending`, `promoted`, `archived` |
| `promoted_to_id` | TEXT | — | Memory ID if promoted |
| `created_at` | TEXT | `datetime('now')` | — |

**FTS**: `daily_log_items_fts` — content (porter unicode61 tokenizer)

**Indexes**: `daily_log_id`, `status`, `importance`

---

### `memory_history`

Audit trail for all memory operations.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `mhist_` prefix |
| `db` | TEXT NOT NULL | — | Which database |
| `memory_id` | TEXT NOT NULL | — | Which memory |
| `operation` | TEXT NOT NULL | — | `created`, `updated`, `superseded`, `deleted`, `promoted` |
| `content_before` | TEXT | — | Previous value |
| `content_after` | TEXT | — | New value |
| `reason` | TEXT | — | Why it changed |
| `changed_at` | TEXT | `datetime('now')` | — |

**Indexes**: `memory_id`, `operation`

---

### `chat_sessions`

Conversation tracking across sessions.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `sess_` prefix |
| `db` | TEXT NOT NULL | — | Which database |
| `title` | TEXT | — | Session name |
| `summary` | TEXT | — | Auto-summary |
| `key_decisions` | TEXT | — | JSON array |
| `key_facts` | TEXT | — | JSON array |
| `project_id` | TEXT | — | Associated project |
| `message_count` | INTEGER | 0 | — |
| `started_at` | TEXT | `datetime('now')` | — |
| `ended_at` | TEXT | — | — |
| `status` | TEXT | `'active'` | `active`, `ended`, `archived` |

**Indexes**: `(db, status, started_at DESC)`

---

### `resources`

URLs, articles, repos, tools, tutorials.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `db` | TEXT NOT NULL | — | — |
| `title` | TEXT NOT NULL | — | — |
| `url` | TEXT | — | — |
| `resource_type` | TEXT | — | `article`, `video`, `repo`, `tool`, `tutorial`, `asset`, `documentation`, `package` |
| `description` | TEXT | — | — |
| `notes` | TEXT | — | Personal notes |
| `key_takeaways` | TEXT | — | JSON array |
| `tags` | TEXT | — | JSON array |
| `category` | TEXT | — | Grouping |
| `status` | TEXT | `'captured'` | `captured`, `reading`, `read`, `reference`, `archived` |
| `quality_rating` | INTEGER | — | 1–5 |
| `project_id` | TEXT | — | — |
| `source_memory_id` | TEXT | — | FK to memory |
| `domain` | TEXT | — | Auto-extracted from URL |
| `created_at` | TEXT | `datetime('now')` | — |
| `accessed_at` | TEXT | — | — |
| `access_count` | INTEGER | 0 | — |

**Indexes**: `domain`, `resource_type`, `status`, `project_id`

**Vector**: `vec_resources` — 384-dim

---

### `notes`

Long-form content — documents, specs, retrospectives.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `db` | TEXT NOT NULL | — | — |
| `title` | TEXT NOT NULL | — | — |
| `content` | TEXT NOT NULL | — | Full content |
| `note_type` | TEXT | `'note'` | `note`, `document`, `gdd`, `design`, `retrospective`, `spec`, `meeting`, `journal` |
| `summary` | TEXT | — | Brief summary |
| `key_points` | TEXT | — | JSON array |
| `tags` | TEXT | — | JSON array |
| `category` | TEXT | — | Grouping |
| `parent_note_id` | TEXT | — | Hierarchical notes |
| `version` | INTEGER | 1 | Auto-increments on content change |
| `previous_version_id` | TEXT | — | Link to prior version |
| `project_id` | TEXT | — | — |
| `entity_id` | TEXT | — | — |
| `word_count` | INTEGER | — | Auto-calculated |
| `has_embedding` | INTEGER | 0 | — |
| `embedding_model` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**FTS**: `notes_fts` — title, content, summary, tags (porter unicode61 tokenizer)

**Vector**: `vec_notes` — 384-dim

**Indexes**: `note_type`, `project_id`, `parent_note_id`

---

### `timeline_events`

Calendar-like events — milestones, deadlines, releases.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `db` | TEXT NOT NULL | — | — |
| `title` | TEXT NOT NULL | — | — |
| `description` | TEXT | — | — |
| `event_type` | TEXT | — | `milestone`, `deadline`, `release`, `decision`, `meeting`, `payment`, `learning`, `life_event` |
| `event_date` | TEXT NOT NULL | — | ISO 8601 |
| `end_date` | TEXT | — | For multi-day events |
| `is_all_day` | INTEGER | 1 | — |
| `timezone` | TEXT | `'Asia/Kolkata'` | — |
| `is_recurring` | INTEGER | 0 | — |
| `recurrence_rule` | TEXT | — | RRULE format |
| `status` | TEXT | `'upcoming'` | `upcoming`, `completed`, `missed`, `cancelled` |
| `completed_at` | TEXT | — | — |
| `importance` | REAL | 5.0 | 1–10 |
| `project_id` | TEXT | — | — |
| `entity_id` | TEXT | — | — |
| `memory_id` | TEXT | — | — |
| `reminder_before` | TEXT | — | JSON array of offsets |
| `created_at` | TEXT | `datetime('now')` | — |

**Indexes**: `event_date`, `event_type`, `status`, `project_id`

---

### `summaries`

Auto-generated rollups — daily, weekly, monthly, project, topic.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `db` | TEXT NOT NULL | — | — |
| `summary_type` | TEXT NOT NULL | — | `daily`, `weekly`, `monthly`, `project`, `topic` |
| `period_start` | TEXT | — | ISO date |
| `period_end` | TEXT | — | ISO date |
| `project_id` | TEXT | — | — |
| `topic` | TEXT | — | — |
| `title` | TEXT | — | — |
| `content` | TEXT NOT NULL | — | Summary body |
| `source_memory_ids` | TEXT | — | JSON array |
| `source_session_ids` | TEXT | — | JSON array |
| `memory_count` | INTEGER | — | — |
| `completeness` | REAL | — | 0–1 |
| `needs_review` | INTEGER | 0 | 1 if human review needed |
| `generated_at` | TEXT | `datetime('now')` | — |
| `generated_by` | TEXT | `'claude'` | — |

**Indexes**: `summary_type`, `(period_start, period_end)`

---

### `config`

Tunable system parameters.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `key` | TEXT PK | — | Dot-notation key |
| `value` | TEXT NOT NULL | — | JSON string value |
| `description` | TEXT | — | Human-readable purpose |
| `updated_at` | TEXT | `datetime('now')` | — |

**Default keys**:
- `retrieval.vector_weight` = `"0.4"`
- `retrieval.fts_weight` = `"0.3"`
- `retrieval.recency_weight` = `"0.2"`
- `retrieval.importance_weight` = `"0.1"`

---

### `templates`

Reusable content with `{{placeholder}}` variables.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `db` | TEXT NOT NULL | — | — |
| `name` | TEXT NOT NULL | — | Template name (unique per db) |
| `title` | TEXT | — | Human-readable title |
| `description` | TEXT | — | What it's for |
| `content` | TEXT NOT NULL | — | Markdown with `{{placeholders}}` |
| `template_type` | TEXT | — | `message`, `document`, `code`, `prompt`, `workflow` |
| `category` | TEXT | — | Grouping |
| `tags` | TEXT | — | JSON array |
| `use_count` | INTEGER | 0 | — |
| `last_used_at` | TEXT | — | — |
| `version` | INTEGER | 1 | — |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Unique constraint**: `(db, name)`

**Indexes**: `(db, name)`, `template_type`

---

### `query_log`

Passive search analytics.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid with `qlog_` prefix |
| `db` | TEXT NOT NULL | — | — |
| `query_text` | TEXT NOT NULL | — | Search query |
| `query_source` | TEXT | — | `fts`, `vector`, `hybrid`, `sql` |
| `result_count` | INTEGER | — | — |
| `result_ids` | TEXT | — | JSON array |
| `execution_time_ms` | INTEGER | — | — |
| `session_id` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |

**Indexes**: `created_at`, `query_source`

---

## Therapy Schema (therapy.db only)

### `sessions`

Therapy session logs.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `title` | TEXT NOT NULL | — | Session title |
| `date` | TEXT NOT NULL | — | Session date |
| `summary` | TEXT | — | — |
| `patterns_identified` | TEXT | — | JSON array |
| `action_items` | TEXT | — | JSON array |
| `emotional_state` | TEXT | — | Before/during/after |
| `metadata` | TEXT | — | JSON |
| `created_at` | TEXT | `datetime('now')` | — |

### `patterns`

Behavioral and cognitive patterns.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `name` | TEXT NOT NULL | — | Pattern name |
| `description` | TEXT NOT NULL | — | — |
| `pattern_type` | TEXT | — | `behavioral`, `cognitive`, `emotional`, `relational`, `defense_mechanism` |
| `triggers` | TEXT | — | JSON array |
| `manifestations` | TEXT | — | JSON array |
| `underlying_need` | TEXT | — | What need is served |
| `impact_positive` | TEXT | — | Strengths |
| `impact_negative` | TEXT | — | Costs |
| `affected_relationships` | TEXT | — | — |
| `status` | TEXT | `'active'` | `active`, `working_on`, `resolved`, `recurring` |
| `awareness_level` | TEXT | `'identified'` | `identified`, `understood`, `actively_managing`, `resolved` |
| `first_identified_at` | TEXT | — | — |
| `last_triggered_at` | TEXT | — | — |
| `trigger_count` | INTEGER | 0 | — |
| `coping_strategies` | TEXT | — | JSON array of strategy IDs |
| `source_session_id` | TEXT | — | Session where identified |
| `related_memory_ids` | TEXT | — | JSON array |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Indexes**: `pattern_type`, `status`

### `coping_strategies`

What works for managing patterns.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `name` | TEXT NOT NULL | — | Strategy name |
| `description` | TEXT NOT NULL | — | How it works |
| `strategy_type` | TEXT | — | `grounding`, `cognitive`, `behavioral`, `communication`, `physical`, `social` |
| `target_patterns` | TEXT | — | JSON array of pattern IDs |
| `target_emotions` | TEXT | — | JSON array |
| `target_situations` | TEXT | — | JSON array |
| `steps` | TEXT | — | JSON array (step-by-step) |
| `time_required` | TEXT | — | e.g., "5 minutes" |
| `effectiveness_rating` | REAL | — | 1–10 |
| `success_count` | INTEGER | 0 | — |
| `fail_count` | INTEGER | 0 | — |
| `what_helps` | TEXT | — | — |
| `what_hinders` | TEXT | — | — |
| `variations` | TEXT | — | — |
| `source` | TEXT | — | Where learned |
| `learned_at` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Indexes**: `strategy_type`, `effectiveness_rating DESC`

---

## HLG Schema (hlg.db only)

### `projects`

Freelance game/app projects.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `name` | TEXT NOT NULL | — | — |
| `status` | TEXT | `'active'` | `active`, `paused`, `completed`, `archived` |
| `client_id` | TEXT | — | FK → entities(id) |
| `rate_usd` | REAL | — | Hourly rate |
| `deadline` | TEXT | — | Due date |
| `start_date` | TEXT | — | — |
| `actual_end_date` | TEXT | — | — |
| `payment_status` | TEXT | `'unpaid'` | `unpaid`, `invoiced`, `paid`, `disputed` |
| `payment_date` | TEXT | — | — |
| `invoice_number` | TEXT | — | — |
| `hours_estimated` | REAL | — | — |
| `hours_tracked` | REAL | 0 | — |
| `gdd_summary` | TEXT | — | — |
| `repository_url` | TEXT | — | — |
| `build_url` | TEXT | — | — |
| `drive_folder` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

**Indexes**: `client_id`, `payment_status`

### `modules`

Reusable Unity modules.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `name` | TEXT NOT NULL UNIQUE | — | — |
| `category` | TEXT NOT NULL | — | `core`, `game_feel`, `ui`, `meta` |
| `description` | TEXT | — | — |
| `current_version` | TEXT | — | Semver |
| `dependencies` | TEXT | — | JSON array |
| `config_options` | TEXT | — | JSON object |
| `folder_path` | TEXT | — | — |
| `source_path` | TEXT | — | Relative path in repo |
| `namespace` | TEXT | — | C# namespace |
| `main_class` | TEXT | — | Primary MonoBehaviour |
| `package_name` | TEXT | — | UPM format |
| `unity_min_version` | TEXT | — | — |
| `maturity` | TEXT | `'alpha'` | `prototype`, `alpha`, `beta`, `stable`, `deprecated` |
| `status` | TEXT | `'documented'` | `prototype`, `documented`, `released` |
| `tags` | TEXT | — | JSON array |
| `api_summary` | TEXT | — | LLM-friendly API description |
| `setup_instructions` | TEXT | — | — |
| `known_issues` | TEXT | — | — |
| `changelog` | TEXT | — | — |
| `public_url` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |
| `updated_at` | TEXT | `datetime('now')` | — |

### `module_usage`

Module usage in projects (legacy, simple tracking).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `module_id` | TEXT NOT NULL | — | FK → modules(id) |
| `project_id` | TEXT NOT NULL | — | FK → projects(id) |
| `customizations` | TEXT | — | — |
| `issues` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |

### `gdd_features`

Game Design Document features for projects.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `project_id` | TEXT NOT NULL | — | FK → projects(id) |
| `feature_name` | TEXT NOT NULL | — | — |
| `description` | TEXT | — | — |
| `category` | TEXT | — | `core_mechanic`, `ui`, `progression`, `meta`, `monetization`, `polish` |
| `priority` | TEXT | `'medium'` | `critical`, `high`, `medium`, `low` |
| `status` | TEXT | `'planned'` | `planned`, `in_progress`, `done`, `cut` |
| `coverage_module_id` | TEXT | — | Module that covers it |
| `coverage_percentage` | REAL | 0.0 | — |
| `implementation_notes` | TEXT | — | — |
| `estimated_hours` | REAL | — | — |
| `actual_hours` | REAL | — | — |
| `created_at` | TEXT | `datetime('now')` | — |

**Indexes**: `project_id`, `status`

### `module_versions`

Version history for modules.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `module_id` | TEXT NOT NULL | — | FK → modules(id) |
| `version` | TEXT NOT NULL | — | Semver |
| `version_type` | TEXT | `'patch'` | `major`, `minor`, `patch` |
| `unity_min_version` | TEXT | — | — |
| `unity_max_version` | TEXT | — | — |
| `changelog` | TEXT | — | — |
| `breaking_changes` | TEXT | — | — |
| `migration_notes` | TEXT | — | — |
| `is_stable` | INTEGER | 0 | — |
| `known_issues` | TEXT | — | — |
| `git_tag` | TEXT | — | — |
| `git_commit` | TEXT | — | — |
| `released_at` | TEXT | `datetime('now')` | — |
| `released_by` | TEXT | — | — |

**Unique constraint**: `(module_id, version)`

**Index**: `module_id`

### `module_dependencies`

Dependency graph between modules.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `module_id` | TEXT NOT NULL | — | — |
| `depends_on_module_id` | TEXT NOT NULL | — | — |
| `dependency_type` | TEXT | `'required'` | `required`, `optional`, `suggests` |
| `min_version` | TEXT | — | — |
| `max_version` | TEXT | — | — |
| `reason` | TEXT | — | — |
| `created_at` | TEXT | `datetime('now')` | — |

**Unique constraint**: `(module_id, depends_on_module_id)`

### `project_modules`

Junction table: which modules are used in which projects.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | nanoid |
| `project_id` | TEXT NOT NULL | — | — |
| `module_id` | TEXT NOT NULL | — | — |
| `module_version` | TEXT | — | — |
| `locked_version` | INTEGER | 0 | — |
| `integration_status` | TEXT | `'planned'` | `planned`, `in_progress`, `integrated`, `removed` |
| `customization_level` | TEXT | `'none'` | `none`, `minor`, `major` |
| `customization_notes` | TEXT | — | — |
| `custom_namespace` | TEXT | — | — |
| `issues_encountered` | TEXT | — | — |
| `workarounds_applied` | TEXT | — | — |
| `integration_hours` | REAL | — | — |
| `added_at` | TEXT | `datetime('now')` | — |
| `integrated_at` | TEXT | — | — |
| `removed_at` | TEXT | — | — |

**Unique constraint**: `(project_id, module_id)`

**Indexes**: `project_id`, `module_id`

---

## Vector Tables (All Databases)

Virtual tables using `sqlite-vec` for KNN search:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories  USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities  USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes     USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_resources USING vec0(embedding float[384]);
```

**Model**: all-MiniLM-L6-v2 (384-dim, float32, ~90MB download on first use)

**Keying**: Vector tables use the same rowid as the base table. Records are linked by rowid, not by the text ID.

---

## FTS Tables

```sql
-- memories_fts: content, category, tags
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, category, tags, content='memories', content_rowid='rowid'
);

-- entities_fts: name, description, type, tags
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    name, description, type, tags, content='entities', content_rowid='rowid'
);

-- daily_log_items_fts: content (porter tokenizer)
CREATE VIRTUAL TABLE IF NOT EXISTS daily_log_items_fts USING fts5(
    content, content='daily_log_items', content_rowid='rowid',
    tokenize='porter unicode61'
);

-- notes_fts: title, content, summary, tags (porter tokenizer)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, summary, tags, content='notes', content_rowid='rowid',
    tokenize='porter unicode61'
);
```

**Sync**: Automatic via INSERT/UPDATE/DELETE triggers on base tables. FTS stays in sync without manual intervention.

---

## Schema Migration Strategy

New columns are added via `ALTER TABLE ADD COLUMN` in `runMigrations()`. The function checks if a column exists before adding:

```typescript
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.pragma(`table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

Post-migration indexes are created after columns exist. This is idempotent — runs on every startup safely.

**Tables are never dropped or recreated**. Only additive changes.
