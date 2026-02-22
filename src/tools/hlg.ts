import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

export function registerHlgTools(server: McpServer): void {
  // create_project
  server.tool(
    "create_hlg_project",
    "Create a new HLG freelance project with financial tracking, timeline, and external links",
    {
      name: z.string().describe("Project name"),
      rate_usd: z.number().optional().describe("Rate in USD"),
      deadline: z.string().optional().describe("Deadline (ISO date)"),
      gdd_summary: z.string().optional().describe("Game Design Document summary"),
      client_id: z.string().optional().describe("Client entity ID (FK to entities)"),
      start_date: z.string().optional().describe("When work actually started (ISO date)"),
      hours_estimated: z.number().optional().describe("Estimated hours for the project"),
      repository_url: z.string().optional().describe("GitHub/GitLab link"),
      build_url: z.string().optional().describe("TestFlight/PlayStore link"),
      drive_folder: z.string().optional().describe("Google Drive folder URL"),
      phase: z.enum(["prototype", "integration", "polish", "feedback"]).optional().describe("Project phase"),
    },
    async ({ name, rate_usd, deadline, gdd_summary, client_id, start_date, hours_estimated, repository_url, build_url, drive_folder, phase }) => {
      const db = getDb("hlg");
      const id = generateId("proj");

      db.prepare(`
        INSERT INTO projects (id, name, rate_usd, deadline, gdd_summary, client_id, start_date, hours_estimated, repository_url, build_url, drive_folder, phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, rate_usd ?? null, deadline ?? null, gdd_summary ?? null, client_id ?? null, start_date ?? null, hours_estimated ?? null, repository_url ?? null, build_url ?? null, drive_folder ?? null, phase ?? null);

      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    }
  );

  // get_projects
  server.tool(
    "get_hlg_projects",
    "Get HLG freelance projects, optionally filtered by status",
    {
      status: z.string().optional().describe("Filter by status: active, paused, completed, archived"),
    },
    async ({ status }) => {
      const db = getDb("hlg");
      let sql = "SELECT * FROM projects";
      const params: unknown[] = [];

      if (status) {
        sql += " WHERE status = ?";
        params.push(status);
      }
      sql += " ORDER BY updated_at DESC";

      const projects = db.prepare(sql).all(...params);
      return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }] };
    }
  );

  // update_project
  server.tool(
    "update_hlg_project",
    "Update an HLG project's details, financials, timeline, or external links",
    {
      id: z.string().describe("Project ID"),
      name: z.string().optional().describe("New name"),
      status: z.string().optional().describe("New status: active, paused, completed, archived"),
      rate_usd: z.number().optional().describe("New rate"),
      deadline: z.string().optional().describe("New deadline"),
      gdd_summary: z.string().optional().describe("Updated GDD summary"),
      client_id: z.string().optional().describe("Client entity ID"),
      start_date: z.string().optional().describe("When work started (ISO date)"),
      actual_end_date: z.string().optional().describe("When work finished (ISO date)"),
      payment_status: z.string().optional().describe("Payment status: unpaid, invoiced, paid, disputed"),
      payment_date: z.string().optional().describe("When payment received (ISO date)"),
      invoice_number: z.string().optional().describe("Invoice number"),
      hours_estimated: z.number().optional().describe("Estimated hours"),
      hours_tracked: z.number().optional().describe("Hours tracked so far"),
      repository_url: z.string().optional().describe("GitHub/GitLab link"),
      build_url: z.string().optional().describe("TestFlight/PlayStore link"),
      drive_folder: z.string().optional().describe("Google Drive folder URL"),
      phase: z.enum(["prototype", "integration", "polish", "feedback"]).optional().describe("Project phase"),
    },
    async ({ id, name, status, rate_usd, deadline, gdd_summary, client_id, start_date, actual_end_date, payment_status, payment_date, invoice_number, hours_estimated, hours_tracked, repository_url, build_url, drive_folder, phase }) => {
      const db = getDb("hlg");

      const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Error: Project '${id}' not found` }], isError: true };
      }

      const updates: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (status !== undefined) { updates.push("status = ?"); params.push(status); }
      if (rate_usd !== undefined) { updates.push("rate_usd = ?"); params.push(rate_usd); }
      if (deadline !== undefined) { updates.push("deadline = ?"); params.push(deadline); }
      if (gdd_summary !== undefined) { updates.push("gdd_summary = ?"); params.push(gdd_summary); }
      if (client_id !== undefined) { updates.push("client_id = ?"); params.push(client_id); }
      if (start_date !== undefined) { updates.push("start_date = ?"); params.push(start_date); }
      if (actual_end_date !== undefined) { updates.push("actual_end_date = ?"); params.push(actual_end_date); }
      if (payment_status !== undefined) { updates.push("payment_status = ?"); params.push(payment_status); }
      if (payment_date !== undefined) { updates.push("payment_date = ?"); params.push(payment_date); }
      if (invoice_number !== undefined) { updates.push("invoice_number = ?"); params.push(invoice_number); }
      if (hours_estimated !== undefined) { updates.push("hours_estimated = ?"); params.push(hours_estimated); }
      if (hours_tracked !== undefined) { updates.push("hours_tracked = ?"); params.push(hours_tracked); }
      if (repository_url !== undefined) { updates.push("repository_url = ?"); params.push(repository_url); }
      if (build_url !== undefined) { updates.push("build_url = ?"); params.push(build_url); }
      if (drive_folder !== undefined) { updates.push("drive_folder = ?"); params.push(drive_folder); }
      if (phase !== undefined) { updates.push("phase = ?"); params.push(phase); }

      if (updates.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update" }], isError: true };
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  // register_module
  server.tool(
    "register_module",
    "Register a reusable Unity module in the HLG module library with versioning, maturity, and documentation",
    {
      name: z.string().describe("Module name (unique)"),
      category: z.enum(["core", "game_feel", "ui", "meta"]).describe("Module category"),
      description: z.string().optional().describe("Module description"),
      dependencies: z.array(z.string()).optional().describe("Module dependencies (names)"),
      config_options: z.record(z.unknown()).optional().describe("Configuration options"),
      folder_path: z.string().optional().describe("Path to module folder"),
      current_version: z.string().optional().describe("Current semver version (e.g. '1.2.0')"),
      unity_min_version: z.string().optional().describe("Minimum Unity version tested"),
      maturity: z.enum(["prototype", "alpha", "beta", "stable", "deprecated"]).optional().describe("Module maturity level (default: alpha)"),
      namespace: z.string().optional().describe("C# namespace"),
      main_class: z.string().optional().describe("Primary MonoBehaviour/class name"),
      source_path: z.string().optional().describe("Relative path in repo"),
      tags: z.array(z.string()).optional().describe("Tags for discoverability (e.g. ['grid', '2d', 'puzzle'])"),
      api_summary: z.string().optional().describe("LLM-friendly description of public API"),
      setup_instructions: z.string().optional().describe("How to integrate"),
      known_issues: z.string().optional().describe("Known gotchas and workarounds"),
      package_name: z.string().optional().describe("UPM format: 'com.bhavya.gridsystem'"),
      public_url: z.string().optional().describe("Asset Store or GitHub link"),
    },
    async ({ name, category, description, dependencies, config_options, folder_path, current_version, unity_min_version, maturity, namespace, main_class, source_path, tags, api_summary, setup_instructions, known_issues, package_name, public_url }) => {
      const db = getDb("hlg");
      const id = generateId("mod");

      try {
        db.prepare(`
          INSERT INTO modules (id, name, category, description, dependencies, config_options, folder_path, current_version, unity_min_version, maturity, namespace, main_class, source_path, tags, api_summary, setup_instructions, known_issues, package_name, public_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, name, category,
          description ?? null,
          dependencies ? JSON.stringify(dependencies) : null,
          config_options ? JSON.stringify(config_options) : null,
          folder_path ?? null,
          current_version ?? null,
          unity_min_version ?? null,
          maturity ?? "alpha",
          namespace ?? null,
          main_class ?? null,
          source_path ?? null,
          tags ? JSON.stringify(tags) : null,
          api_summary ?? null,
          setup_instructions ?? null,
          known_issues ?? null,
          package_name ?? null,
          public_url ?? null,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE constraint")) {
          return { content: [{ type: "text" as const, text: `Module '${name}' already exists` }], isError: true };
        }
        throw err;
      }

      const module = db.prepare("SELECT * FROM modules WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(module, null, 2) }] };
    }
  );

  // log_module_usage
  server.tool(
    "log_module_usage",
    "Log usage of a module in a project, including customizations and issues",
    {
      module_id: z.string().describe("Module ID"),
      project_id: z.string().describe("Project ID"),
      customizations: z.string().optional().describe("What was customized"),
      issues: z.string().optional().describe("Any issues encountered"),
    },
    async ({ module_id, project_id, customizations, issues }) => {
      const db = getDb("hlg");
      const id = generateId("mu");

      db.prepare(`
        INSERT INTO module_usage (id, module_id, project_id, customizations, issues)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, module_id, project_id, customizations ?? null, issues ?? null);

      const usage = db.prepare("SELECT * FROM module_usage WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(usage, null, 2) }] };
    }
  );
}
