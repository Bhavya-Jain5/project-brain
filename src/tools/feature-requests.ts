import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { generateId } from "../utils/id.js";

const requestTypeEnum = z.enum(["new_table", "new_tool", "new_database", "schema_change", "other"]);

function getRequestedBy(): string {
  return process.argv.includes("--stdio") ? "claude_desktop" : "http_client";
}

export function registerFeatureRequestTools(server: McpServer): void {
  server.tool(
    "request_feature",
    "Submit a feature request for Project Brain (new tables, tools, schema changes, etc.). Project Master reviews and deletes rows once implemented.",
    {
      request_type: requestTypeEnum.describe("Type of request"),
      description: z.string().describe("What you want added or changed"),
    },
    async ({ request_type, description }) => {
      const db = getDb("core");
      const id = generateId("fr");
      const requested_by = getRequestedBy();

      db.prepare(`
        INSERT INTO feature_requests (id, requested_by, request_type, description)
        VALUES (?, ?, ?, ?)
      `).run(id, requested_by, request_type, description);

      const row = db.prepare("SELECT * FROM feature_requests WHERE id = ?").get(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] };
    }
  );
}
