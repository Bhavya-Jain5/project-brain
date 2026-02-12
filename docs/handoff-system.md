# Handoff System

A context-sharing bridge between Claude Chat (decision layer) and Claude Code (implementation layer). One handoff ID = one working session spanning both clients.

## Concept

Chat makes decisions, Code implements them. When Chat has context, tasks, or decisions to share with Code (or vice versa), they create a handoff. The other client reads the handoff by ID and picks up the thread.

```
Chat: "Here's what we decided..."  ──create_handoff──>  [hof_abc123]
                                                              │
Code: reads handoff, starts work   <──get_handoff─────────────┘
                                                              │
Code: "Hit a problem, need input"  ──add_to_handoff──>  [hof_abc123]
                                                              │
Chat: reads reply, makes decision  <──get_handoff─────────────┘
                                                              │
Chat: "Go with option B"           ──add_to_handoff──>  [hof_abc123]
                                                              │
...repeat until done...            ──close_handoff──>   [completed]
```

## How It Works

### ID-based access only
There are no list or search tools. You access a handoff exclusively by its ID (e.g. `hof_a3x9k2...`). The user manually pastes the ID into the other client to restore context. This is intentional -- it keeps the system simple and explicit.

### Client identity
Every entry is tagged with who wrote it: `"chat"` or `"code"`.

- **Chat** = Claude Desktop, Claude.ai, mobile (the decision layer)
- **Code** = Claude Code CLI (the implementation layer)

Detection: all clients default to `"chat"`. Claude Code must explicitly pass `as_client: "code"` on every tool call. This is because both Claude Desktop and Claude Code use stdio transport, so there's no automatic way to distinguish them.

### Read tracking
Each handoff tracks two cursors: `chat_last_seen` and `code_last_seen`. These are entry sequence numbers. When you call `get_handoff`, the response includes `new_entries` -- entries the current client hasn't seen yet. Call `mark_handoff_read` to advance your cursor.

When you write an entry (via `create_handoff` or `add_to_handoff`), your own cursor is automatically advanced -- you've obviously seen what you just wrote.

### Entry lifecycle
Entries are append-only during an active session. No editing or deleting individual entries. When `close_handoff` is called, all entries are deleted and the handoff is marked `completed`. The handoff row itself persists (for reference), but the conversation is wiped.

## Database Schema

Two tables in `core.db`:

```sql
CREATE TABLE handoffs (
    id TEXT PRIMARY KEY,             -- nanoid with 'hof_' prefix
    title TEXT NOT NULL,             -- short description of the session
    project TEXT,                    -- optional tag: 'dnd', 'hlg', etc.
    chat_last_seen INTEGER DEFAULT 0,-- last entry seq seen by chat
    code_last_seen INTEGER DEFAULT 0,-- last entry seq seen by code
    status TEXT DEFAULT 'active',    -- 'active' or 'completed'
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE handoff_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- global auto-increment
    handoff_id TEXT NOT NULL REFERENCES handoffs(id),
    from_client TEXT NOT NULL,       -- 'chat' or 'code'
    type TEXT NOT NULL,              -- entry type (see below)
    content TEXT NOT NULL,           -- the actual message
    created_at TEXT
);
```

### Entry types

| Type | Meaning | Typical sender |
|------|---------|----------------|
| `context` | Background info, decisions made, requirements | Chat |
| `task` | Specific work item to implement | Chat |
| `progress` | Status update on ongoing work | Code |
| `question` | Need input/decision from the other side | Either |
| `decision` | Answer to a question, direction chosen | Chat |
| `done` | Work completed, deliverable ready | Code |

## Tools Reference

### create_handoff

Create a new handoff session. The `content` becomes the first entry (type: `context`).

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Short title for the session |
| `content` | string | yes | Initial context to share |
| `project` | string | no | Project tag ('dnd', 'hlg', etc.) |
| `as_client` | "chat" \| "code" | no | Defaults to "chat". Set "code" from Claude Code |

**Returns:** The handoff record + initial entry.

**Example:**
```
create_handoff(
  title: "DnD campaign arc planning",
  content: "We decided on a 3-act structure. Act 1: ...",
  project: "dnd",
  as_client: "code"
)
→ { handoff: { id: "hof_V1StGXR8Z...", ... }, entries: [...] }
```

### get_handoff

Retrieve a handoff by ID. Shows all entries and highlights unseen ones.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Handoff ID |
| `as_client` | "chat" \| "code" | no | Defaults to "chat" |

**Returns:** `{ handoff, entries, new_entries, new_count }`

- `entries` — all entries in order
- `new_entries` — only entries with `seq > your last_seen`
- `new_count` — how many new entries there are

### add_to_handoff

Append an entry to an active handoff.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Handoff ID |
| `type` | enum | yes | One of: context, task, progress, question, decision, done |
| `content` | string | yes | The message |
| `as_client` | "chat" \| "code" | no | Defaults to "chat" |

**Returns:** The updated handoff + the new entry.

Fails if the handoff is already completed.

### mark_handoff_read

Advance your read cursor to the latest entry. After this, `get_handoff` will show `new_count: 0`.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Handoff ID |
| `as_client` | "chat" \| "code" | no | Defaults to "chat" |

### close_handoff

Close the session. Deletes all entries and marks the handoff as `completed`.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Handoff ID |

## Typical Workflow

### 1. Chat creates the handoff
User is in Claude Desktop discussing a plan. Once decisions are made:
```
User: "Hand this off to Claude Code for implementation"
Chat calls: create_handoff(title: "Implement auth system", content: "We decided on JWT with refresh tokens. Requirements: ...")
Chat returns: "Handoff created: hof_abc123. Paste this ID into Claude Code."
```

### 2. User switches to Claude Code
```
User: "Pick up handoff hof_abc123"
Code calls: get_handoff(id: "hof_abc123", as_client: "code")
Code sees: new_entries with the context from Chat
Code calls: mark_handoff_read(id: "hof_abc123", as_client: "code")
Code begins implementing...
```

### 3. Code hits a question
```
Code calls: add_to_handoff(id: "hof_abc123", type: "question", content: "Should refresh tokens expire after 7d or 30d?", as_client: "code")
Code tells user: "I've added a question to the handoff. Check with Chat."
```

### 4. User goes back to Chat
```
User: "Check handoff hof_abc123"
Chat calls: get_handoff(id: "hof_abc123")
Chat sees: new_entries with Code's question
Chat calls: add_to_handoff(id: "hof_abc123", type: "decision", content: "30 days. Also add a 'remember me' option.")
```

### 5. User returns to Code
```
User: "Check the handoff"
Code calls: get_handoff(id: "hof_abc123", as_client: "code")
Code sees: Chat's decision as new_entry
Code implements and eventually:
Code calls: add_to_handoff(id: "hof_abc123", type: "done", content: "Auth system implemented. PR #42 ready for review.", as_client: "code")
```

### 6. Close it out
```
Either client: close_handoff(id: "hof_abc123")
→ Entries wiped, status set to 'completed'
```

## Notes

- Handoffs live in `core.db` -- accessible from both stdio and HTTP transport
- No FTS or search indexing on handoff tables (not needed for ID-only access)
- The `project` tag is informational only, not used for filtering
- Entries accumulate during the session (no auto-pruning) but are lightweight SQL rows
- After `close_handoff`, the handoff row persists with `status: 'completed'` but all entries are gone
