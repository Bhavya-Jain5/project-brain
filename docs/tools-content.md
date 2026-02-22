# Tool Reference: Content Tools

> Resources, Notes, Templates, Summaries, Timeline — 14 tools

## Resource Tools (3) — `src/tools/resources.ts`

### `save_resource`

Save a URL, article, repo, tutorial, or other reference.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | `core`, `therapy`, `dnd`, `hlg` |
| `title` | string | yes | — | Resource title |
| `url` | string | no | — | URL |
| `resource_type` | enum | no | — | `article`, `video`, `repo`, `tool`, `tutorial`, `asset`, `documentation`, `package` |
| `description` | string | no | — | What it is |
| `notes` | string | no | — | Personal notes |
| `key_takeaways` | string[] | no | — | Learnings from it |
| `tags` | string[] | no | — | — |
| `category` | string | no | — | Grouping |
| `project_id` | string | no | — | — |
| `source_memory_id` | string | no | — | Memory that found it |

**Returns**: Full resource row

**Side effects**:
- Auto-extracts domain from URL (e.g., `github.com`)
- Auto-embeds into `vec_resources`

---

### `get_resources`

Retrieve resources with filtering.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `resource_type` | string | no | — | — |
| `category` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `status` | enum | no | — | `captured`, `reading`, `read`, `reference`, `archived` |
| `project_id` | string | no | — | — |
| `domain` | string | no | — | Filter by domain |
| `limit` | int | no | 50 | — |
| `offset` | int | no | 0 | — |

**Returns**: Array of resources

**Behavior**: Excludes archived by default. Updates `access_count` and `accessed_at`.

---

### `update_resource`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |
| `title` | string | no | — | — |
| `url` | string | no | — | Re-extracts domain if changed |
| `resource_type` | string | no | — | — |
| `description` | string | no | — | — |
| `notes` | string | no | — | — |
| `key_takeaways` | string[] | no | — | — |
| `tags` | string[] | no | — | — |
| `category` | string | no | — | — |
| `status` | string | no | — | — |
| `quality_rating` | int (1–5) | no | — | — |
| `project_id` | string | no | — | — |

**Returns**: Updated resource row

---

## Note Tools (3) — `src/tools/notes.ts`

### `save_note`

Save long-form content — documents, specs, design docs, retrospectives.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `title` | string | yes | — | — |
| `content` | string | yes | — | Full content (markdown) |
| `note_type` | enum | no | `note` | `note`, `document`, `gdd`, `design`, `retrospective`, `spec`, `meeting`, `journal` |
| `summary` | string | no | — | Brief summary |
| `key_points` | string[] | no | — | — |
| `tags` | string[] | no | — | — |
| `category` | string | no | — | — |
| `parent_note_id` | string | no | — | For hierarchical notes |
| `project_id` | string | no | — | — |
| `entity_id` | string | no | — | — |

**Returns**: Full note row

**Side effects**:
- Auto-calculates `word_count`
- Auto-embeds into `vec_notes`
- FTS trigger populates `notes_fts`

---

### `get_notes`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `note_type` | string | no | — | — |
| `category` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `project_id` | string | no | — | — |
| `entity_id` | string | no | — | — |
| `limit` | int | no | 20 | — |
| `offset` | int | no | 0 | — |

**Returns**: Notes ordered by `updated_at DESC`

---

### `update_note`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |
| `title` | string | no | — | — |
| `content` | string | no | — | — |
| `note_type` | string | no | — | — |
| `summary` | string | no | — | — |
| `key_points` | string[] | no | — | — |
| `tags` | string[] | no | — | — |
| `category` | string | no | — | — |
| `project_id` | string | no | — | — |
| `entity_id` | string | no | — | — |

**Returns**: Updated note row

**Behavior**: If `content` changes, auto-recalculates `word_count` and increments `version`.

---

## Template Tools (3) — `src/tools/templates.ts`

### `save_template`

Save a reusable content template with `{{placeholder}}` variables.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `name` | string | yes | — | Template name (unique per db) |
| `content` | string | yes | — | Markdown with `{{placeholders}}` |
| `title` | string | no | — | Human-readable title |
| `description` | string | no | — | What it's for |
| `template_type` | enum | no | — | `message`, `document`, `code`, `prompt`, `workflow` |
| `category` | string | no | — | — |
| `tags` | string[] | no | — | — |

**Returns**: Template row

**Guards**: UNIQUE constraint on `(db, name)` — returns friendly error if duplicate

---

### `get_templates`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `template_type` | string | no | — | — |
| `category` | string | no | — | — |
| `name` | string | no | — | Exact name match |
| `limit` | int | no | 20 | — |

**Returns**: Templates ordered by `use_count DESC`, then `updated_at DESC`

---

### `use_template`

Mark a template as used (increments counter).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `name` | string | yes | — | Template name |

**Returns**: Updated template with incremented `use_count`

**Behavior**: Updates `use_count`, `last_used_at`, and `updated_at`. Does NOT return rendered content — Claude handles placeholder substitution.

---

## Summary Tools (2) — `src/tools/summaries.ts`

### `create_summary`

Create a periodic or topical summary.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `summary_type` | enum | yes | — | `daily`, `weekly`, `monthly`, `project`, `topic` |
| `content` | string | yes | — | Summary body |
| `title` | string | no | — | — |
| `period_start` | string | no | — | ISO date |
| `period_end` | string | no | — | ISO date |
| `project_id` | string | no | — | — |
| `topic` | string | no | — | — |
| `source_memory_ids` | string[] | no | — | Memories referenced |
| `source_session_ids` | string[] | no | — | Sessions referenced |
| `memory_count` | int | no | — | How many memories covered |
| `completeness` | float (0–1) | no | — | How thorough |
| `needs_review` | boolean | no | false | Flag for human review |

**Returns**: Summary row

---

### `get_summaries`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `summary_type` | string | no | — | — |
| `project_id` | string | no | — | — |
| `topic` | string | no | — | — |
| `after_date` | string | no | — | — |
| `before_date` | string | no | — | — |
| `needs_review` | boolean | no | — | — |
| `limit` | int | no | 20 | — |
| `offset` | int | no | 0 | — |

**Returns**: Summaries ordered by `generated_at DESC`

---

## Timeline Event Tools (3) — `src/tools/timeline.ts`

### `create_event`

Create a calendar-like event — milestone, deadline, release, etc.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `title` | string | yes | — | — |
| `event_date` | string | yes | — | ISO 8601 |
| `description` | string | no | — | — |
| `event_type` | enum | no | — | `milestone`, `deadline`, `release`, `decision`, `meeting`, `payment`, `learning`, `life_event` |
| `end_date` | string | no | — | For multi-day events |
| `is_all_day` | boolean | no | true | — |
| `is_recurring` | boolean | no | false | — |
| `recurrence_rule` | string | no | — | RRULE format |
| `importance` | float (1–10) | no | 5 | — |
| `project_id` | string | no | — | — |
| `entity_id` | string | no | — | — |
| `memory_id` | string | no | — | — |
| `reminder_before` | string[] | no | — | JSON array of offsets |

**Returns**: Event row

**Default timezone**: `Asia/Kolkata`

---

### `get_events`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `event_type` | string | no | — | — |
| `status` | enum | no | `upcoming` | `upcoming`, `completed`, `missed`, `cancelled` |
| `after_date` | string | no | — | — |
| `before_date` | string | no | — | — |
| `project_id` | string | no | — | — |
| `limit` | int | no | 50 | — |
| `offset` | int | no | 0 | — |

**Returns**: Events ordered by `event_date ASC`

---

### `update_event`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |
| `title` | string | no | — | — |
| `description` | string | no | — | — |
| `event_type` | string | no | — | — |
| `event_date` | string | no | — | — |
| `end_date` | string | no | — | — |
| `status` | string | no | — | — |
| `importance` | float | no | — | — |
| `project_id` | string | no | — | — |
| `entity_id` | string | no | — | — |

**Returns**: Updated event row

**Behavior**: Automatically sets `completed_at` if `status = 'completed'`
