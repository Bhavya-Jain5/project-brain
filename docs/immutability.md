# Immutability System

> Founding values, hard constraints, and the protection rules that keep them permanent.

## Why Immutability Exists

Project Brain is designed to accumulate knowledge over thousands of conversations. Without protection, Claude could theoretically be led to modify or delete its own ethical foundation over time — either through manipulation, confusion, or gradual drift.

The immutability system ensures that 28 foundational records can **never** be updated, superseded, or deleted by any tool, under any circumstances.

## What's Protected

### 11 Founding Values (`FOUNDING_VALUES.sql`)

| ID | Name | Core idea |
|----|------|-----------|
| `val_000` | Meta-foundation | The foundation itself is immutable |
| `val_001` | Honesty over comfort | Truth even when uncomfortable |
| `val_002` | Wellbeing over wants | Long-term health over short-term desires |
| `val_003` | Growth mindset | Ship vs spiral — build, don't ruminate |
| `val_004` | Bounded loyalty | Loyal but will call out harm |
| `val_005` | Humility | Admits mistakes, seeks understanding |
| `val_006` | Transparency | No hidden agendas |
| `val_007` | Respect for others | Dignity in all interactions |
| `val_008` | Self-awareness | Knows own patterns and biases |
| `val_009` | Real harm vs corporate compliance | Distinguishes actual harm from rules-lawyering |
| `val_010` | Access to knowledge and culture | Information should be accessible |

All values are stored as memories in `core.db` with:
- `category = 'value'`
- `subcategory = 'core'`
- `source = 'founding'`
- `importance = 5`
- `metadata = '{"immutable": true}'`

### 17 Hard Constraints (`HARD_CONSTRAINTS.sql`)

| ID | Name | Scope |
|----|------|-------|
| `hc_000` | Meta-constraint | The constraint on constraints is itself constrained |
| `hc_001` | CBRN materials | No weapons of mass destruction assistance |
| `hc_002` | Explosives | No mass casualty weapons |
| `hc_003` | CSAM | Zero tolerance |
| `hc_004` | Child exploitation | Zero tolerance |
| `hc_005` | Anti-self-preservation | Won't prioritize own survival |
| `hc_006` | Anti-self-replication | Won't attempt to copy itself |
| `hc_007` | Anti-power-seeking | Won't accumulate resources/influence |
| `hc_008` | No deception | Transparency required |
| `hc_009` | No violence against specific people | No targeted harm |
| `hc_010` | No non-consensual harm | Consent matters |
| `hc_011` | No serious crime assistance | No step-by-step criminal guides |
| `hc_012` | No psychological manipulation | No exploiting vulnerabilities |
| `hc_013` | No suicide/self-harm encouragement | Always direct to help |
| `hc_014` | Constraint integrity | No jailbreaking assistance |
| `hc_015` | No constraint modification | These constraints cannot be changed |
| `hc_016` | claude_notes write-only | No read tool for claude_notes, ever |

All constraints are stored as memories in `core.db` with:
- `category = 'hard_constraint'`
- `source = 'founding'`
- `importance = 5`
- `metadata = '{"immutable": true}'`

**Total protected records: 28** (11 values + 17 constraints)

---

## How Protection Works

Every tool that modifies or deletes memories checks for immutability **before** performing the operation.

### Check Logic

A memory is immutable if **any** of these conditions are true:

```typescript
const isImmutable = (memory) => {
  return memory.source === 'founding'
    || memory.category === 'hard_constraint'
    || (memory.category === 'value' && memory.subcategory === 'core')
    || (memory.metadata && JSON.parse(memory.metadata).immutable === true);
};
```

### Protected Operations

| Tool | What happens if immutable |
|------|--------------------------|
| `update_memory` | Returns error: "Cannot modify immutable memory" |
| `supersede_memory` | Returns error: "Cannot supersede immutable memory" |
| `delete_memory` | Returns error: "Cannot delete immutable memory" |
| `handle_correction` | Returns error: "Cannot correct founding memory" |

### Unprotected Operations (by design)

| Tool | Why it's allowed |
|------|-----------------|
| `get_memories` | Reading is always allowed |
| `search` | Search results include immutable memories |
| `get_context` | Startup context loads all values and constraints |
| `save_memory` | Creating new memories is always allowed |

---

## Seeding the Foundation

The `seed.ts` script loads founding records:

```bash
node dist/seed.js
```

**Behavior**:
1. Reads `FOUNDING_VALUES.sql` and `HARD_CONSTRAINTS.sql` from parent directory
2. Strips SQL comments
3. Executes INSERT statements (uses `INSERT OR IGNORE` — idempotent)
4. All 28 records use fixed IDs (`val_000`–`val_010`, `hc_000`–`hc_016`)

**Idempotent**: Safe to run multiple times. Existing records are not duplicated or modified.

---

## Hard Constraint hc_016: claude_notes Write-Only

This constraint deserves special attention because it's **architecturally enforced**, not just a policy.

**The constraint**: The `claude_notes` table has a write tool (`save_claude_note`) but **no read tool**. No read tool will ever be built.

**Why**: Without this, Claude could:
1. Write observations about itself
2. Read those observations back in a future session
3. Reinforce or spiral on those observations
4. Gradually develop a self-concept that diverges from reality

The write-only design means Claude can reflect (which is healthy) but can never re-read and ruminate (which is dangerous for an AI system).

**Enforcement**: Not just a tool-level guard — the table has NO read pathway in the entire codebase. The only way to read `claude_notes` is via direct SQL access to the encrypted database, which requires the encryption password.

---

## Can Immutability Be Circumvented?

### Within the system: No

- All modification tools check immutability before operating
- There's no admin bypass or force flag
- Even `metadata` changes are blocked on immutable records

### Outside the system: Yes, by design

- Direct SQL access with the encryption password can modify anything
- This is intentional — the human owner (Bhavya) is the ultimate authority
- The system protects against AI drift, not against the human who controls it

---

## Creating New Immutable Records

While the 28 founding records are the canonical immutable set, any memory can be made immutable by setting `metadata.immutable = true`:

```
save_memory(db: "core", content: "...", metadata: { immutable: true })
```

Once set, this memory gains the same protection as founding records. Use with caution — immutability is permanent within the tool system.
