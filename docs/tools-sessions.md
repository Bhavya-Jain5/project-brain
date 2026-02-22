# Tool Reference: Session & Context Tools

> Chat Sessions, Handoff, Context, Daily Logs — 16 tools

## Chat Session Tools (4) — `src/tools/chat-sessions.ts`

### `start_session`

Begin a new conversation session. Auto-ends any active session for the same DB.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | `core`, `therapy`, `dnd`, `hlg` |
| `title` | string | no | — | Session name |
| `project_id` | string | no | — | Associate with project entity |

**Returns**: Session row with `sess_` prefixed ID

**Behavior**: If there's an active session for this DB, it's auto-ended first (sets `ended_at`, `status = 'ended'`). Only one active session per DB at a time.

---

### `update_session`

Update a session's metadata during a conversation.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `session_id` | string | yes | — | — |
| `summary` | string | no | — | Session summary |
| `key_decisions` | string[] | no | — | JSON array of decisions |
| `key_facts` | string[] | no | — | JSON array of facts |
| `increment_messages` | boolean | no | true | Bump message_count |

**Returns**: Updated session row

**Behavior**: Searches across ALL databases to find the session. This means you don't need to know which DB the session is in.

---

### `end_session`

Close an active session.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `session_id` | string | yes | — | — |

**Returns**: Updated session with `ended_at` timestamp

**Behavior**: Searches all DBs. Only updates if `status = 'active'`.

---

### `get_recent_sessions`

List recent sessions for a database.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `limit` | int | no | 5 | — |

**Returns**: Sessions ordered by `started_at DESC`

---

## Handoff Tools (5) — `src/tools/handoff.ts`

See [handoff-system.md](handoff-system.md) for full protocol documentation.

### `create_handoff`

Create a new handoff session between Chat and Code.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | yes | — | Short title |
| `content` | string | yes | — | Initial context (becomes first entry) |
| `project` | string | no | — | Optional tag (dnd, hlg, etc.) |
| `as_client` | enum | no | `chat` | `chat` or `code` |

**Returns**: `{ handoff, entries }`

**Behavior**: Creates handoff row + first entry (type: `context`). Auto-advances sender's read cursor.

**Client detection**: All clients default to `chat`. Claude Code must explicitly pass `as_client: "code"` — both Claude Desktop and Claude Code use stdio, so there's no automatic way to distinguish.

---

### `get_handoff`

Retrieve a handoff by ID.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | Handoff ID |
| `as_client` | enum | no | `chat` | — |

**Returns**: `{ handoff, entries, new_entries, new_count }`

- `entries` — all entries in order
- `new_entries` — only entries with seq > your `last_seen`
- `new_count` — count of unseen entries

---

### `add_to_handoff`

Append an entry to an active handoff.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | Handoff ID |
| `type` | enum | yes | — | `context`, `task`, `progress`, `question`, `decision`, `done` |
| `content` | string | yes | — | Message body |
| `as_client` | enum | no | `chat` | — |

**Returns**: Updated handoff + new entry

**Guards**: Rejects if handoff is completed

---

### `mark_handoff_read`

Advance read cursor to latest entry.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | — |
| `as_client` | enum | no | `chat` | — |

**Returns**: `{ marked_read: true, client, last_seen }`

---

### `close_handoff`

Close and clean up a handoff session.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | — |

**Returns**: Confirmation

**Behavior**: Deletes ALL entries, marks handoff `status = 'completed'`. The handoff row persists for reference but all conversation data is wiped.

---

## Context Tools (2) — `src/tools/context.ts`

### `get_context`

Startup context loader — gives Claude everything it needs to begin a conversation.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `hint` | string | no | — | Topic hint for relevant memory retrieval |

**Returns**:
```json
{
  "values": [...],           // 11 founding values
  "hard_constraints": [...], // 17 hard constraints
  "personality": [...],      // Personality observations
  "corrections": [...],      // Recent corrections (high priority)
  "user_facts": [...],       // Facts about Bhavya
  "preferences": [...],      // User preferences
  "active_projects": [...],  // Active project entities
  "recent_decisions": [...], // Last 10 decisions
  "recent_learnings": [...], // Last 10 learnings
  "active_blockers": [...],  // Unresolved blockers
  "daily_log": {...},        // Today's log (if exists)
  "last_session": {...},     // Most recent session
  "relevant_to_hint": [...]  // Memories matching hint (if provided)
}
```

**Behavior**: Fetches from core.db. If `hint` is provided, also performs a semantic search for relevant memories. This is the recommended first tool call at conversation start.

---

### `get_project_context`

Get all context for a specific project.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `project_id` | string | yes | — | Entity ID of the project |

**Returns**: `{ project, memories, decisions, blockers, related_entities }`

---

## Daily Log Tools (5) — `src/tools/daily-logs.ts`

### `add_daily_log_item`

Quick-append an item to today's log. Auto-creates the daily log if needed.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `content` | string | yes | — | Item content |
| `item_type` | enum | no | `observation` | `observation`, `idea`, `decision`, `task`, `question`, `correction` |
| `importance` | float (1–10) | no | 5 | — |

**Returns**: `{ daily_log_id, item_id, date }`

**Behavior**: If no daily log exists for today + this DB, creates one first. Uses IST date (Asia/Kolkata).

---

### `get_daily_log`

Get a specific day's log with all items.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `date` | string | no | today | YYYY-MM-DD |

**Returns**: `{ log, items }` — items ordered by importance DESC, then created_at ASC

---

### `promote_daily_item`

Promote a daily log item to a permanent memory.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `item_id` | string | yes | — | Daily log item ID |
| `category` | enum | yes | — | Category for new memory |
| `tags` | string[] | no | — | — |
| `importance` | int (1–5) | no | 3 | — |

**Returns**: `{ promoted: true, memory_id, item_id }`

**Behavior**:
1. Creates new memory from item content
2. Updates item: `status = 'promoted'`, `promoted_to_id = memory_id`
3. Logs to memory_history (operation: `promoted`)
4. All in a transaction

---

### `review_pending_items`

Get pending daily log items that haven't been promoted or archived.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `days_back` | int | no | 7 | How far back to look |

**Returns**: `{ count, items }` — ordered by importance DESC, log_date DESC

---

### `cleanup_daily_logs`

Automatically clean up old daily log data.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `db` | enum | yes | — | — |
| `days_old` | int | no | 7 | — |

**Returns**: `{ discarded_items, archived_logs }`

**Behavior**:
1. Archive pending items with importance < 4 that are older than `days_old` days
2. Archive logs older than 30 days
3. Return counts of affected records
