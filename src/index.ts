import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env") });

import { initializeAllSchemas } from "./db/schema.js";
import { closeAll } from "./db/connection.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerEntityTools } from "./tools/entity.js";
import { registerLinkTools } from "./tools/link.js";
import { registerSearchTools } from "./tools/search.js";
import { registerContextTools } from "./tools/context.js";
import { registerPainPointTools } from "./tools/pain-points.js";
import { registerPersonalityTools } from "./tools/personality.js";
import { registerHlgTools } from "./tools/hlg.js";
import { registerTherapyTools } from "./tools/therapy.js";
import { registerClaudeNoteTools } from "./tools/claude-notes.js";
import { registerTimeTools } from "./tools/time.js";

/**
 * Create a fully configured MCP server instance with all tools registered.
 */
function createServer(): McpServer {
  const server = new McpServer(
    { name: "project-brain", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  registerMemoryTools(server);
  registerEntityTools(server);
  registerLinkTools(server);
  registerSearchTools(server);
  registerContextTools(server);
  registerPainPointTools(server);
  registerPersonalityTools(server);
  registerHlgTools(server);
  registerTherapyTools(server);
  registerClaudeNoteTools(server);
  registerTimeTools(server);

  return server;
}

// Initialize all database schemas
initializeAllSchemas();

// Graceful shutdown
process.on("SIGINT", () => {
  closeAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeAll();
  process.exit(0);
});

// ──────────────────────────────────────────────────
// Transport selection: --stdio for Claude Code, HTTP for Claude.ai
// ──────────────────────────────────────────────────

const isStdio = process.argv.includes("--stdio");

if (isStdio) {
  // stdio mode — local Claude Code, no auth needed
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  // HTTP mode — remote Claude.ai via Cloudflare tunnel
  const express = (await import("express")).default;
  const { requestLogger } = await import("./middleware/logger.js");
  const { banCheck } = await import("./middleware/ban.js");
  const { rateLimit } = await import("./middleware/rate-limit.js");
  const { authToken } = await import("./middleware/auth.js");

  const app = express();
  app.use(express.json());

  // Trust proxy (Cloudflare tunnel) for correct req.ip
  app.set("trust proxy", true);

  // Ensure Accept header includes required MCP content types.
  // Claude.ai may not send the correct Accept header, causing 406.
  // Must patch both req.headers AND req.rawHeaders because the SDK's
  // @hono/node-server wrapper reads rawHeaders to build the Web Standard Request.
  app.use("/mcp", (req, _res, next) => {
    const accept = req.headers.accept || "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      const desired = "application/json, text/event-stream";
      req.headers.accept = desired;
      // Patch rawHeaders array: find existing Accept or append
      const idx = req.rawHeaders.findIndex(h => h.toLowerCase() === "accept");
      if (idx !== -1) {
        req.rawHeaders[idx + 1] = desired;
      } else {
        req.rawHeaders.push("Accept", desired);
      }
    }
    next();
  });

  // Track active sessions: sessionId → { transport, server }
  const sessions = new Map<string, {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  }>();

  // ── Middleware order ──────────────────────────────
  // 1. Log request (always, even failures)
  // 2. Check if IP is banned → 403
  // 3. Rate limit check → 429
  // 4. Validate X-Auth-Token → 401 (+ auto-ban on 5 failures)
  // 5. Process MCP request
  // Note: CF-Access validation happens at Cloudflare edge (service token headers
  // are consumed there and not forwarded to origin). AUTH_TOKEN provides server-side auth.
  const securityStack = [requestLogger, banCheck, rateLimit, authToken];

  // ── POST /mcp — main MCP endpoint ────────────────
  app.post("/mcp", ...securityStack, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && !session) {
      // Session ID provided but not found — stale session
      res.status(404).json({ error: "Session not found. Start a new session." });
      return;
    }

    if (!session) {
      // New session — create transport + server
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createServer();

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Store session after handleRequest generates the session ID
      const sid = transport.sessionId;
      if (sid) {
        sessions.set(sid, { transport, server });
      }
      return;
    }

    // Existing session — route to its transport
    await session.transport.handleRequest(req, res, req.body);
  });

  // ── GET /mcp — SSE stream for server-initiated messages ──
  app.get("/mcp", ...securityStack, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      res.status(400).json({ error: "Missing or invalid session ID" });
      return;
    }

    await session.transport.handleRequest(req, res);
  });

  // ── DELETE /mcp — terminate session ──────────────
  app.delete("/mcp", ...securityStack, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await session.transport.close();
    sessions.delete(sessionId!);
    res.status(200).json({ success: true });
  });

  // ── Health check (no auth required) ──────────────
  app.get("/health", (_, res) => {
    res.json({
      status: "ok",
      server: "project-brain",
      version: "1.0.0",
      sessions: sessions.size,
      uptime: process.uptime(),
    });
  });

  const PORT = parseInt(process.env.PORT || "3577", 10);
  app.listen(PORT, () => {
    console.log(`[project-brain] HTTP server listening on port ${PORT}`);
    console.log(`[project-brain] Security: rate-limit(100/min) + auth-token + auto-ban(5 fails = 1hr)`);
    console.log(`[project-brain] Active sessions: ${sessions.size}`);
  });
}
