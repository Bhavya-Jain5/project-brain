# Tool Reference: Domain-Specific Tools

> HLG Freelance, GDD Features, Therapy Sessions, Therapy Patterns — 16 tools

## HLG Freelance Tools (5) — `src/tools/hlg.ts`

These tools target **hlg.db** exclusively.

### `create_hlg_project`

Create a new freelance project.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Project name |
| `rate_usd` | float | no | — | Hourly rate in USD |
| `deadline` | string | no | — | Due date (ISO) |
| `gdd_summary` | string | no | — | Game Design Document summary |
| `client_id` | string | no | — | FK to entities.id |
| `start_date` | string | no | — | — |
| `hours_estimated` | float | no | — | — |
| `repository_url` | string | no | — | GitHub/GitLab |
| `build_url` | string | no | — | TestFlight/PlayStore |
| `drive_folder` | string | no | — | Google Drive |

**Returns**: Project row

---

### `get_hlg_projects`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `status` | enum | no | — | `active`, `paused`, `completed`, `archived` |

**Returns**: Projects ordered by `updated_at DESC`

---

### `update_hlg_project`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | — |
| `name` | string | no | — | — |
| `status` | string | no | — | — |
| `rate_usd` | float | no | — | — |
| `deadline` | string | no | — | — |
| `gdd_summary` | string | no | — | — |
| `client_id` | string | no | — | — |
| `start_date` | string | no | — | — |
| `actual_end_date` | string | no | — | — |
| `payment_status` | enum | no | — | `unpaid`, `invoiced`, `paid`, `disputed` |
| `payment_date` | string | no | — | — |
| `invoice_number` | string | no | — | — |
| `hours_estimated` | float | no | — | — |
| `hours_tracked` | float | no | — | — |
| `repository_url` | string | no | — | — |
| `build_url` | string | no | — | — |
| `drive_folder` | string | no | — | — |

**Returns**: Updated project row

---

### `register_module`

Register a reusable Unity module in the module library.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Unique name |
| `category` | enum | yes | — | `core`, `game_feel`, `ui`, `meta` |
| `description` | string | no | — | — |
| `dependencies` | string[] | no | — | Other module names |
| `config_options` | object | no | — | Available settings |
| `folder_path` | string | no | — | — |
| `current_version` | string | no | — | Semver |
| `unity_min_version` | string | no | — | — |
| `maturity` | enum | no | `alpha` | `prototype`, `alpha`, `beta`, `stable`, `deprecated` |
| `namespace` | string | no | — | C# namespace |
| `main_class` | string | no | — | Primary MonoBehaviour |
| `source_path` | string | no | — | — |
| `tags` | string[] | no | — | — |
| `api_summary` | string | no | — | LLM-friendly API description |
| `setup_instructions` | string | no | — | — |
| `known_issues` | string | no | — | — |
| `package_name` | string | no | — | UPM format |
| `public_url` | string | no | — | — |

**Returns**: Module row

**Guards**: UNIQUE constraint on `name`

---

### `log_module_usage`

Record that a module was used in a project.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `module_id` | string | yes | — | — |
| `project_id` | string | yes | — | — |
| `customizations` | string | no | — | What was changed |
| `issues` | string | no | — | Problems encountered |

**Returns**: Module usage entry

---

## GDD Feature Tools (3) — `src/tools/gdd.ts`

Game Design Document feature tracking for HLG projects.

### `add_gdd_features`

Batch-add features to a project's GDD (max 50 per call).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project_id` | string | yes | — | HLG project ID |
| `features` | array | yes | — | Up to 50 feature objects |

Each feature object:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `feature_name` | string | yes | — | — |
| `description` | string | no | — | — |
| `category` | enum | no | — | `core_mechanic`, `ui`, `progression`, `meta`, `monetization`, `polish` |
| `priority` | enum | no | `medium` | `critical`, `high`, `medium`, `low` |
| `estimated_hours` | float | no | — | — |

**Returns**: `{ saved: number, ids: string[] }`

**Transaction-wrapped**: All features saved atomically.

---

### `get_gdd_features`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project_id` | string | yes | — | — |
| `status` | enum | no | — | `planned`, `in_progress`, `done`, `cut` |
| `priority` | string | no | — | — |
| `category` | string | no | — | — |
| `limit` | int | no | 50 | — |

**Returns**: Features ordered by priority (critical → high → medium → low), then `feature_name`

---

### `check_gdd_coverage`

Analyze which GDD features can be covered by existing modules.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project_id` | string | yes | — | — |
| `include_experimental` | boolean | no | false | Include prototype/alpha modules |

**Returns**:
```json
{
  "covered": [...],      // Features with a matching stable/beta module
  "partial": [...],      // Features partially covered
  "uncovered": [...],    // Features needing custom development
  "summary": {
    "total_features": 25,
    "fully_covered": 8,
    "partially_covered": 5,
    "needs_building": 12,
    "coverage_percentage": 52.0,
    "estimated_time_saved": 120  // hours from covered features
  }
}
```

**Category mapping** (feature → module categories):
- `core_mechanic` → `core`
- `ui` → `ui`
- `progression` → `core`, `meta`
- `meta` → `meta`
- `polish` → `game_feel`
- `monetization` → `meta`

**Module filter**: Only `stable` and `beta` maturity unless `include_experimental = true`.

---

## Therapy Session Tools (3) — `src/tools/therapy.ts`

These tools target **therapy.db** exclusively.

### `create_therapy_session`

Log a therapy session.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | yes | — | Session title (e.g., "Rose Day Incident") |
| `date` | string | yes | — | Session date (ISO) |
| `summary` | string | no | — | What happened |
| `patterns_identified` | string[] | no | — | Patterns noticed |
| `action_items` | string[] | no | — | Follow-up tasks |
| `emotional_state` | string | no | — | Before/during/after |
| `metadata` | object | no | — | Extra data |

**Returns**: Session row

---

### `get_therapy_sessions`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `limit` | int | no | 20 | — |

**Returns**: Sessions ordered by `date DESC`

---

### `update_therapy_session`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | — |
| `summary` | string | no | — | — |
| `patterns_identified` | string[] | no | — | — |
| `action_items` | string[] | no | — | — |
| `emotional_state` | string | no | — | — |

**Returns**: Updated session row

---

## Therapy Pattern Tools (5) — `src/tools/therapy-patterns.ts`

Behavioral and cognitive pattern tracking. Targets **therapy.db**.

### `create_pattern`

Identify a new behavioral or cognitive pattern.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Pattern name (e.g., "Avoidance under pressure") |
| `description` | string | yes | — | Detailed description |
| `pattern_type` | enum | no | — | `behavioral`, `cognitive`, `emotional`, `relational`, `defense_mechanism` |
| `triggers` | string[] | no | — | What sets it off |
| `manifestations` | string[] | no | — | How it shows up |
| `underlying_need` | string | no | — | What need is being served |
| `impact_positive` | string | no | — | Strengths of pattern |
| `impact_negative` | string | no | — | Costs and downsides |
| `source_session_id` | string | no | — | Therapy session where identified |

**Returns**: Pattern row

---

### `get_patterns`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `pattern_type` | string | no | — | — |
| `status` | enum | no | — | `active`, `working_on`, `resolved`, `recurring` |
| `awareness_level` | enum | no | — | `identified`, `understood`, `actively_managing`, `resolved` |
| `limit` | int | no | 20 | — |

**Returns**: Patterns ordered by `trigger_count DESC`, `updated_at DESC`

---

### `update_pattern`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | — |
| `name` | string | no | — | — |
| `description` | string | no | — | — |
| `pattern_type` | string | no | — | — |
| `triggers` | string[] | no | — | — |
| `manifestations` | string[] | no | — | — |
| `underlying_need` | string | no | — | — |
| `impact_positive` | string | no | — | — |
| `impact_negative` | string | no | — | — |
| `status` | string | no | — | — |
| `awareness_level` | string | no | — | — |
| `coping_strategies` | string[] | no | — | Strategy IDs |

**Returns**: Updated pattern row

---

### `create_coping_strategy`

Record a coping strategy for managing patterns.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Strategy name (e.g., "Box breathing") |
| `description` | string | yes | — | How it works |
| `strategy_type` | enum | no | — | `grounding`, `cognitive`, `behavioral`, `communication`, `physical`, `social` |
| `target_patterns` | string[] | no | — | Pattern IDs this helps with |
| `target_emotions` | string[] | no | — | Emotions it addresses |
| `target_situations` | string[] | no | — | Contexts where it works |
| `steps` | string[] | no | — | Step-by-step instructions |
| `time_required` | string | no | — | e.g., "5 minutes" |
| `effectiveness_rating` | float (1–10) | no | — | — |
| `source` | string | no | — | Where learned |
| `learned_at` | string | no | — | When acquired |

**Returns**: Strategy row

---

### `get_coping_strategies`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `strategy_type` | string | no | — | — |
| `min_effectiveness` | float | no | — | — |
| `pattern_id` | string | no | — | Searches `target_patterns` via LIKE |
| `limit` | int | no | 20 | — |

**Returns**: Strategies ordered by `effectiveness_rating DESC`, `updated_at DESC`
