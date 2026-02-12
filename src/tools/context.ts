import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, isValidDbName, type DbName } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";

const dbEnum = z.enum(["core", "therapy", "dnd", "hlg"]);

export function registerContextTools(server: McpServer): void {
  // get_context — startup context for beginning of conversations
  server.tool(
    "get_context",
    "Get startup context for a new conversation. Call this at the beginning of every chat to load personality, facts, active projects, recent decisions, and blockers.",
    {
      hint: z.string().optional().describe("Optional: first message or topic hint for relevance filtering"),
    },
    async ({ hint }) => {
      // Always initialize core
      initializeSchema("core");
      const core = getDb("core");

      // Personality memories
      const personality = core.prepare(`
        SELECT * FROM memories WHERE category = 'personality' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 20
      `).all();

      // Founding values
      const values = core.prepare(`
        SELECT * FROM memories WHERE category = 'value' AND status = 'active'
        ORDER BY CAST(json_extract(metadata, '$.priority') AS INTEGER) ASC
      `).all();

      // Hard constraints
      const constraints = core.prepare(`
        SELECT * FROM memories WHERE category = 'hard_constraint' AND status = 'active'
        ORDER BY CAST(json_extract(metadata, '$.priority') AS INTEGER) ASC
      `).all();

      // User facts (high-importance first)
      const userFacts = core.prepare(`
        SELECT * FROM memories WHERE category = 'fact' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 20
      `).all();

      // Preferences (high-importance first)
      const preferences = core.prepare(`
        SELECT * FROM memories WHERE category = 'preference' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 20
      `).all();

      // Recent decisions (high-importance first)
      const recentDecisions = core.prepare(`
        SELECT * FROM memories WHERE category = 'decision' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 10
      `).all();

      // Recent learnings (high-importance first)
      const recentLearnings = core.prepare(`
        SELECT * FROM memories WHERE category = 'learning' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 5
      `).all();

      // Active blockers (high-importance first)
      const activeBlockers = core.prepare(`
        SELECT * FROM memories WHERE category = 'blocker' AND status = 'active'
        ORDER BY importance DESC, updated_at DESC
      `).all();

      // Try to get active projects from hlg.db if it exists
      let activeProjects: unknown[] = [];
      try {
        initializeSchema("hlg");
        const hlg = getDb("hlg");
        activeProjects = hlg.prepare(
          "SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC"
        ).all();
      } catch { /* hlg.db not ready yet, that's fine */ }

      // If hint provided, search for relevant memories across core
      let relevant: unknown[] = [];
      if (hint) {
        try {
          const terms = hint.trim().split(/\s+/).filter(Boolean).map(t => `"${t}"`).join(" ");
          relevant = core.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.rowid
            WHERE memories_fts MATCH ? AND m.status = 'active'
            ORDER BY rank LIMIT 10
          `).all(terms);
        } catch { /* FTS query failed, skip */ }
      }

      const context = {
        values,
        hard_constraints: constraints,
        personality,
        user_facts: userFacts,
        preferences,
        active_projects: activeProjects,
        recent_decisions: recentDecisions,
        recent_learnings: recentLearnings,
        active_blockers: activeBlockers,
        ...(relevant.length > 0 ? { relevant_to_hint: relevant } : {}),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(context, null, 2) }] };
    }
  );

  // get_project_context — context for working on a specific project
  server.tool(
    "get_project_context",
    "Get full context for a specific project: the project entity, its memories, decisions, blockers, and related entities.",
    {
      db: dbEnum.describe("Which database the project is in"),
      project_id: z.string().describe("The project entity ID"),
    },
    async ({ db: dbName, project_id }) => {
      if (!isValidDbName(dbName)) {
        return { content: [{ type: "text" as const, text: `Invalid database: ${dbName}` }], isError: true };
      }
      const db = getDb(dbName);

      // Get the project entity
      const project = db.prepare("SELECT * FROM entities WHERE id = ?").get(project_id);
      if (!project) {
        return { content: [{ type: "text" as const, text: `Project '${project_id}' not found` }], isError: true };
      }

      // All memories for this project
      const memories = db.prepare(
        "SELECT * FROM memories WHERE project_id = ? AND status = 'active' ORDER BY updated_at DESC"
      ).all(project_id);

      // Decisions
      const decisions = db.prepare(
        "SELECT * FROM memories WHERE project_id = ? AND category = 'decision' AND status = 'active' ORDER BY updated_at DESC"
      ).all(project_id);

      // Blockers
      const blockers = db.prepare(
        "SELECT * FROM memories WHERE project_id = ? AND category = 'blocker' AND status = 'active' ORDER BY updated_at DESC"
      ).all(project_id);

      // Related entities via links
      const relatedEntities = db.prepare(`
        SELECT DISTINCT e.*, l.relationship FROM entities e
        JOIN links l ON
          (l.source_type = 'entity' AND l.source_id = e.id AND l.target_type = 'entity' AND l.target_id = ?)
          OR
          (l.target_type = 'entity' AND l.target_id = e.id AND l.source_type = 'entity' AND l.source_id = ?)
        WHERE e.status = 'active' AND e.id != ?
      `).all(project_id, project_id, project_id);

      const context = {
        project,
        memories,
        decisions,
        blockers,
        related_entities: relatedEntities,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(context, null, 2) }] };
    }
  );
}
