# Tool Reference: System & Utility Tools

> Config, Time, Feature Requests, Claude Notes, Personality, Pain Points — 9 tools

## Config Tools (2) — `src/tools/config.ts`

### `get_config`

Retrieve system configuration values.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `key` | string | no | — | Exact key match |
| `prefix` | string | no | — | Pattern match (e.g., `retrieval.`) |

**Returns**: Single config row (if `key`), array (if `prefix`), or all config entries (if neither)

**Usage patterns**:
- `get_config(key: "retrieval.vector_weight")` → single value
- `get_config(prefix: "retrieval.")` → all retrieval weights
- `get_config()` → dump all config

---

### `set_config`

Set a configuration value.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `key` | string | yes | — | Dot-notation key |
| `value` | string | yes | — | JSON string value |
| `description` | string | no | — | Human-readable purpose |

**Returns**: Updated config row

**Behavior**: INSERT OR REPLACE — creates if missing, updates if exists.

**Known config keys**:
| Key | Default | Description |
|-----|---------|-------------|
| `retrieval.vector_weight` | `"0.4"` | Vector similarity weight in hybrid search |
| `retrieval.fts_weight` | `"0.3"` | FTS relevance weight |
| `retrieval.recency_weight` | `"0.2"` | Recency decay weight |
| `retrieval.importance_weight` | `"0.1"` | Importance/mention weight |

---

## Time Tool (1) — `src/tools/time.ts`

### `get_current_time`

Get the current time in both UTC and local (IST) formats.

**Params**: None

**Returns**:
```json
{
  "utc": "2026-02-13T14:30:00.000Z",
  "local": "2/13/2026, 8:00:00 PM",
  "timezone": "Asia/Kolkata",
  "offset": "+05:30",
  "unix": 1771080600000
}
```

**Note**: `local` is formatted using `toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })`.

---

## Feature Request Tool (1) — `src/tools/feature-requests.ts`

### `request_feature`

Submit an idea for a new tool, table, or schema change.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `request_type` | enum | yes | — | `new_table`, `new_tool`, `new_database`, `schema_change`, `other` |
| `description` | string | yes | — | What's being requested |

**Returns**: Feature request row

**Behavior**: Auto-detects source — `claude_desktop` for stdio, `http_client` for HTTP.

---

## Claude Notes Tool (1) — `src/tools/claude-notes.ts`

### `save_claude_note`

Save an internal observation or self-reflection. **WRITE-ONLY** — no read tool exists.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `note` | string | yes | — | Internal observation |
| `conversation_context` | string | no | — | What triggered this note |

**Returns**: Saved note row (id, note, source, conversation_context, created_at)

**Architectural safety**: Hard constraint `hc_016` permanently prohibits building a read tool for this table. Claude can reflect but never re-read and ruminate. This prevents persona drift and self-reinforcing loops.

**Source detection**: Auto-sets `source` to `claude_code` (stdio) or `claude_ai` (HTTP).

---

## Personality Tool (1) — `src/tools/personality.ts`

### `save_personality_note`

Record a personality observation — communication styles, boundaries, jokes, growth.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `content` | string | yes | — | The observation |
| `subcategory` | enum | yes | — | `communication_style`, `observation`, `boundary`, `opinion`, `inside_joke`, `relationship`, `preference`, `growth` |
| `context` | string | no | — | When/why this was observed |

**Returns**: Memory row (category='personality')

**Behavior**: Saves as a memory in **core.db** with:
- `category = 'personality'`
- `subcategory` = provided value
- `tags = ["personality", "evolved"]`
- `metadata.context` = provided context (if any)

---

## Pain Point Tools (3) — `src/tools/pain-points.ts`

### `log_pain_point`

Record a frustration or issue.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | `core`, `therapy`, `dnd`, `hlg` |
| `description` | string | yes | — | What's broken |
| `context` | string | no | — | When/where |
| `severity` | enum | no | `minor` | `minor`, `annoying`, `major`, `critical` |

**Returns**: Pain point row

---

### `get_pain_points`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | no | — | If omitted: searches ALL databases |
| `status` | enum | no | `open` | `open`, `fixing`, `fixed`, `wont_fix` |
| `severity` | string | no | — | — |

**Returns**:
- If `db` specified: array of pain points for that db
- If no `db`: `{ core: [...], therapy: [...], dnd: [...], hlg: [...] }`

---

### `resolve_pain_point`

Mark a pain point as resolved.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `id` | string | yes | — | — |
| `resolution` | string | yes | — | How it was fixed |

**Returns**: Updated pain point with `resolved_at` timestamp, `status = 'fixed'`
