import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

interface GddFeatureRow {
  id: string;
  project_id: string;
  feature_name: string;
  description: string | null;
  category: string | null;
  priority: string;
  status: string;
  coverage_module_id: string | null;
  coverage_percentage: number;
  implementation_notes: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  created_at: string;
}

interface ModuleRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  maturity: string | null;
  status: string;
}

export function registerGddTools(server: McpServer): void {
  // add_gdd_features
  server.tool(
    "add_gdd_features",
    "Batch add features from a Game Design Document to a project. Max 50 per call.",
    {
      project_id: z.string().describe("Project ID to add features to"),
      features: z.array(z.object({
        feature_name: z.string().describe("Name of the feature"),
        description: z.string().optional().describe("Feature description"),
        category: z.enum(["core_mechanic", "ui", "progression", "meta", "monetization", "polish"]).optional().describe("Feature category"),
        priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority level (default: medium)"),
        estimated_hours: z.number().optional().describe("Estimated hours to implement"),
      })).min(1).max(50).describe("Array of features to add (max 50)"),
    },
    async ({ project_id, features }) => {
      const db = getDb("hlg");

      const ids: string[] = [];

      const insert = db.prepare(`
        INSERT INTO gdd_features (id, project_id, feature_name, description, category, priority, estimated_hours)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = db.transaction(() => {
        for (const feature of features) {
          const id = generateId("gddf");
          ids.push(id);
          insert.run(
            id,
            project_id,
            feature.feature_name,
            feature.description ?? null,
            feature.category ?? null,
            feature.priority ?? "medium",
            feature.estimated_hours ?? null,
          );
        }
      });

      transaction();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ saved: ids.length, ids }, null, 2),
        }],
      };
    }
  );

  // get_gdd_features
  server.tool(
    "get_gdd_features",
    "Get GDD features for a project with optional filters, ordered by priority",
    {
      project_id: z.string().describe("Project ID"),
      status: z.enum(["planned", "in_progress", "done", "cut"]).optional().describe("Filter by status"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Filter by priority"),
      category: z.enum(["core_mechanic", "ui", "progression", "meta", "monetization", "polish"]).optional().describe("Filter by category"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    },
    async ({ project_id, status, priority, category, limit }) => {
      const db = getDb("hlg");

      const conditions: string[] = ["project_id = ?"];
      const params: unknown[] = [project_id];

      if (status) {
        conditions.push("status = ?");
        params.push(status);
      }
      if (priority) {
        conditions.push("priority = ?");
        params.push(priority);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }

      const where = conditions.join(" AND ");
      const sql = `
        SELECT * FROM gdd_features
        WHERE ${where}
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END ASC,
          feature_name ASC
        LIMIT ?
      `;
      params.push(limit ?? 50);

      const features = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(features, null, 2) }] };
    }
  );

  // check_gdd_coverage
  server.tool(
    "check_gdd_coverage",
    "Analyze GDD feature coverage against existing reusable modules. Shows what's covered, partial, and needs building.",
    {
      project_id: z.string().describe("Project ID to analyze"),
      include_experimental: z.boolean().optional().describe("Include alpha/experimental modules (default: false)"),
    },
    async ({ project_id, include_experimental }) => {
      const db = getDb("hlg");

      // Get all planned/in_progress features for the project
      const features = db.prepare(`
        SELECT * FROM gdd_features
        WHERE project_id = ? AND status IN ('planned', 'in_progress')
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END ASC
      `).all(project_id) as GddFeatureRow[];

      if (features.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            covered: [],
            partial: [],
            uncovered: [],
            summary: {
              total_features: 0,
              fully_covered: 0,
              partially_covered: 0,
              needs_building: 0,
              coverage_percentage: 0,
              estimated_time_saved: 0,
            },
          }, null, 2) }],
        };
      }

      // Get modules filtered by maturity
      let modulesSql: string;
      if (include_experimental) {
        modulesSql = `SELECT * FROM modules WHERE maturity IN ('stable', 'beta', 'alpha') OR maturity IS NULL`;
      } else {
        modulesSql = `SELECT * FROM modules WHERE maturity IN ('stable', 'beta') OR maturity IS NULL`;
      }
      const modules = db.prepare(modulesSql).all() as ModuleRow[];

      const covered: { feature: GddFeatureRow; module: ModuleRow }[] = [];
      const partial: { feature: GddFeatureRow; candidates: ModuleRow[] }[] = [];
      const uncovered: GddFeatureRow[] = [];
      let estimatedTimeSaved = 0;

      for (const feature of features) {
        const stableMatches: ModuleRow[] = [];
        const otherMatches: ModuleRow[] = [];

        for (const mod of modules) {
          let matches = false;

          // Match by category
          if (feature.category && mod.category) {
            const categoryMap: Record<string, string[]> = {
              core_mechanic: ["core"],
              ui: ["ui"],
              progression: ["core", "meta"],
              meta: ["meta"],
              monetization: ["meta"],
              polish: ["game_feel"],
            };
            const mappedCategories = categoryMap[feature.category] ?? [];
            if (mappedCategories.includes(mod.category)) {
              matches = true;
            }
          }

          // Match by description LIKE patterns
          if (!matches && feature.description && mod.description) {
            const featureWords = feature.feature_name.toLowerCase().split(/\s+/);
            for (const word of featureWords) {
              if (word.length >= 4 && mod.description.toLowerCase().includes(word)) {
                matches = true;
                break;
              }
              if (word.length >= 4 && mod.name.toLowerCase().includes(word)) {
                matches = true;
                break;
              }
            }
          }

          // Also try matching feature description against module name/description
          if (!matches && feature.description) {
            const descWords = feature.description.toLowerCase().split(/\s+/);
            for (const word of descWords) {
              if (word.length >= 4 && mod.name.toLowerCase().includes(word)) {
                matches = true;
                break;
              }
            }
          }

          if (matches) {
            if (mod.maturity === "stable") {
              stableMatches.push(mod);
            } else {
              otherMatches.push(mod);
            }
          }
        }

        if (stableMatches.length > 0) {
          // Fully covered — use the first stable match
          covered.push({ feature, module: stableMatches[0] });
          estimatedTimeSaved += feature.estimated_hours ?? 0;
        } else if (otherMatches.length > 0) {
          // Partial coverage — beta/alpha candidates
          partial.push({ feature, candidates: otherMatches });
          estimatedTimeSaved += (feature.estimated_hours ?? 0) * 0.5;
        } else {
          uncovered.push(feature);
        }
      }

      const totalFeatures = features.length;
      const fullyCovered = covered.length;
      const partiallyCovered = partial.length;
      const needsBuilding = uncovered.length;
      const coveragePercentage = totalFeatures > 0
        ? Math.round(((fullyCovered + partiallyCovered * 0.5) / totalFeatures) * 100)
        : 0;

      const result = {
        covered: covered.map(c => ({
          feature: { id: c.feature.id, feature_name: c.feature.feature_name, category: c.feature.category, priority: c.feature.priority },
          module: { id: c.module.id, name: c.module.name, category: c.module.category, maturity: c.module.maturity },
        })),
        partial: partial.map(p => ({
          feature: { id: p.feature.id, feature_name: p.feature.feature_name, category: p.feature.category, priority: p.feature.priority },
          candidates: p.candidates.map(m => ({ id: m.id, name: m.name, category: m.category, maturity: m.maturity })),
        })),
        uncovered: uncovered.map(f => ({
          id: f.id, feature_name: f.feature_name, category: f.category, priority: f.priority, estimated_hours: f.estimated_hours,
        })),
        summary: {
          total_features: totalFeatures,
          fully_covered: fullyCovered,
          partially_covered: partiallyCovered,
          needs_building: needsBuilding,
          coverage_percentage: coveragePercentage,
          estimated_time_saved: Math.round(estimatedTimeSaved * 10) / 10,
        },
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
