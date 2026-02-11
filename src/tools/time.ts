import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerTimeTools(server: McpServer): void {
  server.tool(
    "get_current_time",
    "Get the actual current time from the server. Use this instead of guessing. Returns UTC and Bhavya's local time (Asia/Kolkata, IST).",
    {},
    async () => {
      const now = new Date();
      const utc = now.toISOString();
      const ist = now.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "long",
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            utc,
            local: ist,
            timezone: "Asia/Kolkata",
            offset: "+05:30",
            unix: Math.floor(now.getTime() / 1000),
          }, null, 2),
        }],
      };
    }
  );
}
