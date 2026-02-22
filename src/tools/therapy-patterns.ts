import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerTherapyPatternTools(server: McpServer): void {
  // create_pattern
  server.tool(
    "create_pattern",
    "Create a behavioral/cognitive/emotional pattern identified through self-reflection or therapy",
    {
      name: z.string().describe("Pattern name (e.g., 'Avoidance under pressure')"),
      description: z.string().describe("Detailed description of the pattern"),
      pattern_type: z.enum(["behavioral", "cognitive", "emotional", "relational", "defense_mechanism"]).optional().describe("Type of pattern"),
      triggers: z.array(z.string()).optional().describe("What triggers this pattern"),
      manifestations: z.array(z.string()).optional().describe("How this pattern manifests"),
      underlying_need: z.string().optional().describe("The underlying need this pattern serves"),
      impact_positive: z.string().optional().describe("Positive impacts of this pattern"),
      impact_negative: z.string().optional().describe("Negative impacts of this pattern"),
      source_session_id: z.string().optional().describe("Therapy session ID where this was identified"),
    },
    async ({ name, description, pattern_type, triggers, manifestations, underlying_need, impact_positive, impact_negative, source_session_id }) => {
      const db = getDb("therapy");
      const id = generateId("pat");

      db.prepare(`
        INSERT INTO patterns (id, name, description, pattern_type, triggers, manifestations, underlying_need, impact_positive, impact_negative, source_session_id, first_identified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id, name, description,
        pattern_type ?? null,
        triggers ? JSON.stringify(triggers) : null,
        manifestations ? JSON.stringify(manifestations) : null,
        underlying_need ?? null,
        impact_positive ?? null,
        impact_negative ?? null,
        source_session_id ?? null,
      );

      const pattern = db.prepare("SELECT * FROM patterns WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(pattern, null, 2) }] };
    }
  );

  // get_patterns
  server.tool(
    "get_patterns",
    "Get behavioral patterns with optional filters",
    {
      pattern_type: z.enum(["behavioral", "cognitive", "emotional", "relational", "defense_mechanism"]).optional().describe("Filter by pattern type"),
      status: z.enum(["active", "working_on", "resolved", "recurring"]).optional().describe("Filter by status"),
      awareness_level: z.enum(["identified", "understood", "actively_managing", "resolved"]).optional().describe("Filter by awareness level"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ pattern_type, status, awareness_level, limit }) => {
      const db = getDb("therapy");

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (pattern_type) {
        conditions.push("pattern_type = ?");
        params.push(pattern_type);
      }
      if (status) {
        conditions.push("status = ?");
        params.push(status);
      }
      if (awareness_level) {
        conditions.push("awareness_level = ?");
        params.push(awareness_level);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit ?? 20);

      const patterns = db.prepare(
        `SELECT * FROM patterns ${where} ORDER BY trigger_count DESC, updated_at DESC LIMIT ?`
      ).all(...params);

      return { content: [{ type: "text" as const, text: JSON.stringify(patterns, null, 2) }] };
    }
  );

  // update_pattern
  server.tool(
    "update_pattern",
    "Update a behavioral pattern's details",
    {
      id: z.string().describe("Pattern ID"),
      name: z.string().optional().describe("Updated name"),
      description: z.string().optional().describe("Updated description"),
      pattern_type: z.enum(["behavioral", "cognitive", "emotional", "relational", "defense_mechanism"]).optional().describe("Updated type"),
      triggers: z.array(z.string()).optional().describe("Updated triggers"),
      manifestations: z.array(z.string()).optional().describe("Updated manifestations"),
      underlying_need: z.string().optional().describe("Updated underlying need"),
      impact_positive: z.string().optional().describe("Updated positive impact"),
      impact_negative: z.string().optional().describe("Updated negative impact"),
      status: z.enum(["active", "working_on", "resolved", "recurring"]).optional().describe("Updated status"),
      awareness_level: z.enum(["identified", "understood", "actively_managing", "resolved"]).optional().describe("Updated awareness level"),
      coping_strategies: z.array(z.string()).optional().describe("Strategy IDs linked to this pattern"),
    },
    async ({ id, name, description, pattern_type, triggers, manifestations, underlying_need, impact_positive, impact_negative, status, awareness_level, coping_strategies }) => {
      const db = getDb("therapy");

      const existing = db.prepare("SELECT * FROM patterns WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Pattern '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (pattern_type !== undefined) { updates.push("pattern_type = ?"); params.push(pattern_type); }
      if (triggers !== undefined) { updates.push("triggers = ?"); params.push(JSON.stringify(triggers)); }
      if (manifestations !== undefined) { updates.push("manifestations = ?"); params.push(JSON.stringify(manifestations)); }
      if (underlying_need !== undefined) { updates.push("underlying_need = ?"); params.push(underlying_need); }
      if (impact_positive !== undefined) { updates.push("impact_positive = ?"); params.push(impact_positive); }
      if (impact_negative !== undefined) { updates.push("impact_negative = ?"); params.push(impact_negative); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (awareness_level !== undefined) { updates.push("awareness_level = ?"); params.push(awareness_level); }
      if (coping_strategies !== undefined) { updates.push("coping_strategies = ?"); params.push(JSON.stringify(coping_strategies)); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE patterns SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM patterns WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // create_coping_strategy
  server.tool(
    "create_coping_strategy",
    "Create a coping strategy for managing patterns or emotional states",
    {
      name: z.string().describe("Strategy name (e.g., 'Box breathing')"),
      description: z.string().describe("Detailed description of the strategy"),
      strategy_type: z.enum(["grounding", "cognitive", "behavioral", "communication", "physical", "social"]).optional().describe("Type of strategy"),
      target_patterns: z.array(z.string()).optional().describe("Pattern IDs this strategy addresses"),
      target_emotions: z.array(z.string()).optional().describe("Emotions this strategy helps with"),
      target_situations: z.array(z.string()).optional().describe("Situations where this strategy applies"),
      steps: z.array(z.string()).optional().describe("Step-by-step instructions"),
      time_required: z.string().optional().describe("How long the strategy takes (e.g., '5 minutes')"),
      effectiveness_rating: z.number().optional().describe("Initial effectiveness rating (1-10)"),
      source: z.string().optional().describe("Where this strategy was learned"),
      learned_at: z.string().optional().describe("When this strategy was learned (ISO date)"),
    },
    async ({ name, description, strategy_type, target_patterns, target_emotions, target_situations, steps, time_required, effectiveness_rating, source, learned_at }) => {
      const db = getDb("therapy");
      const id = generateId("cope");

      db.prepare(`
        INSERT INTO coping_strategies (id, name, description, strategy_type, target_patterns, target_emotions, target_situations, steps, time_required, effectiveness_rating, source, learned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, name, description,
        strategy_type ?? null,
        target_patterns ? JSON.stringify(target_patterns) : null,
        target_emotions ? JSON.stringify(target_emotions) : null,
        target_situations ? JSON.stringify(target_situations) : null,
        steps ? JSON.stringify(steps) : null,
        time_required ?? null,
        effectiveness_rating ?? null,
        source ?? null,
        learned_at ?? null,
      );

      const strategy = db.prepare("SELECT * FROM coping_strategies WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(strategy, null, 2) }] };
    }
  );

  // get_coping_strategies
  server.tool(
    "get_coping_strategies",
    "Get coping strategies with optional filters",
    {
      strategy_type: z.enum(["grounding", "cognitive", "behavioral", "communication", "physical", "social"]).optional().describe("Filter by strategy type"),
      min_effectiveness: z.number().optional().describe("Minimum effectiveness rating (1-10)"),
      pattern_id: z.string().optional().describe("Filter strategies that target a specific pattern ID"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ strategy_type, min_effectiveness, pattern_id, limit }) => {
      const db = getDb("therapy");

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (strategy_type) {
        conditions.push("strategy_type = ?");
        params.push(strategy_type);
      }
      if (min_effectiveness !== undefined) {
        conditions.push("effectiveness_rating >= ?");
        params.push(min_effectiveness);
      }
      if (pattern_id) {
        conditions.push("target_patterns LIKE ?");
        params.push(`%"${pattern_id}"%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit ?? 20);

      const strategies = db.prepare(
        `SELECT * FROM coping_strategies ${where} ORDER BY effectiveness_rating DESC, updated_at DESC LIMIT ?`
      ).all(...params);

      return { content: [{ type: "text" as const, text: JSON.stringify(strategies, null, 2) }] };
    }
  );
}
