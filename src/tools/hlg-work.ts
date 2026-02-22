import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgWorkTools(server: McpServer): void {
  // log_hlg_work
  server.tool(
    "log_hlg_work",
    "Log a work session for an HLG project. Quick capture of what was done, how long, blockers, decisions. Auto-updates actual_hours on system or actual_minutes on task.",
    {
      project_id: z.string().describe("Project ID"),
      summary: z.string().describe("What was done this session"),
      duration_minutes: z.number().optional().describe("How long the session lasted (minutes)"),
      system_id: z.string().optional().describe("System worked on (sys_...)"),
      task_id: z.string().optional().describe("Task worked on (task_...)"),
      blockers: z.string().optional().describe("What's blocking progress"),
      decisions_summary: z.string().optional().describe("Key decisions made"),
      next_steps: z.string().optional().describe("What to do next"),
    },
    async ({ project_id, summary, duration_minutes, system_id, task_id, blockers, decisions_summary, next_steps }) => {
      const db = getDb("hlg");
      const id = generateId("ws");

      const insertWork = db.prepare(`
        INSERT INTO hlg_work_sessions (id, project_id, system_id, task_id, duration_minutes, summary, blockers, decisions_summary, next_steps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateSystemHours = db.prepare(`
        UPDATE hlg_systems SET actual_hours = actual_hours + ?, updated_at = datetime('now') WHERE id = ?
      `);

      const updateTaskMinutes = db.prepare(`
        UPDATE hlg_tasks SET actual_minutes = actual_minutes + ?, updated_at = datetime('now') WHERE id = ?
      `);

      const updateProjectHours = db.prepare(`
        UPDATE projects SET hours_tracked = hours_tracked + ?, updated_at = datetime('now') WHERE id = ?
      `);

      const txn = db.transaction(() => {
        insertWork.run(id, project_id, system_id ?? null, task_id ?? null, duration_minutes ?? null, summary, blockers ?? null, decisions_summary ?? null, next_steps ?? null);

        if (duration_minutes) {
          // Update project total hours
          updateProjectHours.run(duration_minutes / 60, project_id);

          // Update system actual_hours
          if (system_id) {
            updateSystemHours.run(duration_minutes / 60, system_id);
          }

          // Update task actual_minutes
          if (task_id) {
            updateTaskMinutes.run(duration_minutes, task_id);
          }
        }
      });

      txn();

      const session = db.prepare("SELECT * FROM hlg_work_sessions WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
    }
  );

  // generate_hlg_daily_update
  server.tool(
    "generate_hlg_daily_update",
    "Generate a daily update from today's work sessions for an HLG project. Pulls all sessions logged today and formats them.",
    {
      project_id: z.string().describe("Project ID"),
      date: z.string().optional().describe("Date to generate for (ISO date, defaults to today)"),
    },
    async ({ project_id, date }) => {
      const db = getDb("hlg");

      // Get project info
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(project_id) as Record<string, unknown> | undefined;
      if (!project) {
        return { content: [{ type: "text" as const, text: `Error: Project '${project_id}' not found` }], isError: true };
      }

      const targetDate = date || new Date().toISOString().split("T")[0];

      // Get work sessions for the date
      const sessions = db.prepare(`
        SELECT ws.*, s.name as system_name, t.title as task_title
        FROM hlg_work_sessions ws
        LEFT JOIN hlg_systems s ON ws.system_id = s.id
        LEFT JOIN hlg_tasks t ON ws.task_id = t.id
        WHERE ws.project_id = ? AND date(ws.logged_at) = ?
        ORDER BY ws.logged_at ASC
      `).all(project_id, targetDate) as Record<string, unknown>[];

      if (sessions.length === 0) {
        return { content: [{ type: "text" as const, text: `No work sessions found for ${targetDate}` }] };
      }

      // Calculate totals
      let totalMinutes = 0;
      const allBlockers: string[] = [];
      const allDecisions: string[] = [];
      const allNextSteps: string[] = [];

      const workItems: string[] = [];

      for (const s of sessions) {
        if (s.duration_minutes) totalMinutes += s.duration_minutes as number;
        if (s.blockers) allBlockers.push(s.blockers as string);
        if (s.decisions_summary) allDecisions.push(s.decisions_summary as string);
        if (s.next_steps) allNextSteps.push(s.next_steps as string);

        const target = s.system_name || s.task_title || "general";
        const duration = s.duration_minutes ? ` (${s.duration_minutes}min)` : "";
        workItems.push(`- [${target}]${duration}: ${s.summary}`);
      }

      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      let update = `## Daily Update: ${project.name} — ${targetDate}\n\n`;
      update += `**Total time:** ${timeStr} (${sessions.length} session${sessions.length > 1 ? "s" : ""})\n\n`;
      update += `### What I did\n${workItems.join("\n")}\n`;

      if (allBlockers.length > 0) {
        update += `\n### Blockers\n${allBlockers.map(b => `- ${b}`).join("\n")}\n`;
      }

      if (allDecisions.length > 0) {
        update += `\n### Decisions\n${allDecisions.map(d => `- ${d}`).join("\n")}\n`;
      }

      if (allNextSteps.length > 0) {
        update += `\n### Next Steps\n${allNextSteps.map(n => `- ${n}`).join("\n")}\n`;
      }

      return { content: [{ type: "text" as const, text: update }] };
    }
  );
}
