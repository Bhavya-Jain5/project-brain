# Security & Transport

> Dual transport, middleware stack, authentication, rate limiting, auto-ban, logging, session management.

## Transport Modes

Project Brain supports two transport modes, selected at startup:

| Mode | Flag | Use case | Auth | Transport class |
|------|------|----------|------|----------------|
| **Stdio** | `--stdio` | Claude Code (local) | None | `StdioServerTransport` |
| **HTTP** | (default) | Claude.ai (remote) | Full security stack | `StreamableHTTPServerTransport` |

### Stdio Mode

```bash
node dist/index.js --stdio
```

- Direct JSON-RPC over stdin/stdout
- No authentication — assumes trusted local process
- Single McpServer instance, single transport
- Used by Claude Code via the MCP server config

### HTTP Mode

```bash
node dist/index.js
```

- Express 5 server on port 3577 (configurable via `PORT` env)
- Full security middleware stack
- Session-per-client architecture
- Designed for Cloudflare tunnel access from Claude.ai

---

## HTTP Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/mcp` | Yes | Main MCP request handler |
| `GET` | `/mcp` | Yes | SSE stream for server-initiated messages |
| `DELETE` | `/mcp` | Yes | Terminate session |
| `GET` | `/health` | **No** | Health check (monitoring) |

### POST /mcp

Primary endpoint. Handles two cases:

1. **New session**: No `mcp-session-id` header → creates new McpServer + StreamableHTTPServerTransport pair, processes request, stores session
2. **Existing session**: Has `mcp-session-id` header → routes to stored transport

Returns 404 if session ID provided but not found (stale session).

### GET /mcp

SSE (Server-Sent Events) stream for server-initiated messages. Requires valid `mcp-session-id` header. Returns 400 if missing or invalid.

### DELETE /mcp

Terminates a session — closes transport, removes from session map. Returns 404 if session not found.

### GET /health

No authentication required. Returns:
```json
{
  "status": "ok",
  "server": "project-brain",
  "version": "1.0.0",
  "sessions": 2,
  "uptime": 3600.5
}
```

---

## Security Middleware Stack

Applied to all `/mcp` endpoints in this order:

```
Request → Logger → Ban Check → Rate Limit → Auth Token → MCP Handler
```

### 1. Request Logger (`src/middleware/logger.ts`)

Logs every request to `brain-data/logs/security.log` as JSON lines.

**Log entry format**:
```json
{
  "timestamp": "2026-02-13T14:30:00.000Z",
  "ip": "203.0.113.42",
  "method": "POST",
  "path": "/mcp",
  "status": 200,
  "event": "AUTH_FAILED",
  "detail": "Invalid token"
}
```

**Behavior**:
- Always runs first (even if subsequent middleware rejects)
- Status captured via `res.on("finish")` callback
- Append-mode file stream (auto-creates log directory)
- Non-throwing — never breaks the request pipeline

### 2. Ban Check (`src/middleware/ban.ts`)

Checks if the requesting IP is currently banned.

**Configuration**:
- `MAX_FAILURES = 5` — auth failures before ban
- `BAN_DURATION_MS = 3,600,000` — 1 hour ban

**Behavior**:
- In-memory `Map<ip, { count, bannedUntil }>`
- If `bannedUntil > now`: returns **403** `{ error: "Temporarily banned" }`
- If ban has expired: auto-clears and allows through
- Logs `BANNED_REQUEST_BLOCKED` event

### 3. Rate Limiter (`src/middleware/rate-limit.ts`)

Per-IP rate limiting.

**Configuration**:
- **100 requests per 60 seconds** per IP
- Uses `RateLimiterMemory` (in-memory, per-process)
- Keyed by `req.ip || req.socket.remoteAddress`

**Behavior**:
- On limit exceeded: returns **429** `{ error: "Rate limit exceeded" }`
- Logs `RATE_LIMITED` event
- Resets on server restart (in-memory storage)

### 4. Auth Token (`src/middleware/auth.ts`)

Validates the authentication token.

**Token sources** (checked in order):
1. Query parameter: `?auth=TOKEN`
2. Header: `X-Auth-Token: TOKEN`

**On success**:
- Calls `clearAuthFailures(req)` to reset ban counter
- Passes to next middleware

**On failure**:
- Calls `recordAuthFailure(req)` — increments counter, may trigger ban
- Returns **401** `{ error: "Unauthorized" }`
- Logs `AUTH_FAILED` event

**Edge case**: Returns **500** if `AUTH_TOKEN` env var is not set (logs `AUTH_MISCONFIGURED`).

**Why query param**: Claude.ai custom connectors may not support custom headers reliably. The `?auth=TOKEN` query param ensures compatibility.

---

## Accept Header Patching

Claude.ai may not send the correct MCP Accept header, causing 406 errors from the SDK.

**Fix** (applied before security stack):

```typescript
app.use("/mcp", (req, _res, next) => {
  const accept = req.headers.accept || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    const desired = "application/json, text/event-stream";
    req.headers.accept = desired;
    // Also patch rawHeaders — SDK's @hono/node-server reads these
    const idx = req.rawHeaders.findIndex(h => h.toLowerCase() === "accept");
    if (idx !== -1) {
      req.rawHeaders[idx + 1] = desired;
    } else {
      req.rawHeaders.push("Accept", desired);
    }
  }
  next();
});
```

**Why both headers and rawHeaders**: The MCP SDK internally uses `@hono/node-server` which builds a Web Standard `Request` object from `req.rawHeaders`, ignoring `req.headers`. Patching only `req.headers` has no effect.

---

## Session Management

```typescript
const sessions = new Map<string, {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}>();
```

- **New session**: First POST without session header → new McpServer + transport pair
- **Session ID**: Generated via `crypto.randomUUID()` by the transport
- **Stored after first request**: Session ID is only available after `handleRequest` generates it
- **Cleanup**: `transport.onclose` callback removes session from map
- **No shared state**: Each session gets its own McpServer (independent tool registrations)
- **In-memory**: Sessions lost on server restart

---

## Cloudflare Tunnel

The HTTP server is exposed to the internet via a Cloudflare tunnel:

- **Domain**: `brain.bhavya-second-brain.online`
- **Tunnel ID**: `af7a35f0-fb1e-4c5d-86c2-4d5dbe2d9c74`
- **Connector**: Installed as Windows service (`cloudflared service install`)
- **Binary**: `C:\Program Files (x86)\cloudflared\cloudflared.exe` (v2025.8.1)
- **Config**: `C:\Users\jainb\.cloudflared\config.yml`

**Trust proxy**: Express is configured with `app.set("trust proxy", true)` so `req.ip` reflects the client's real IP (not Cloudflare's).

**CF-Access**: Previously had a Cloudflare Access application for edge auth, but it was removed because CF strips service token headers at the edge before forwarding to origin. The `AUTH_TOKEN` provides server-side authentication instead.

---

## Claude.ai Web Connector Status

**BLOCKED** as of February 2026.

Claude.ai custom connectors have been broken since the December 2025 update. The server responds correctly (200), but Claude.ai's client-side fails due to:
- Content Security Policy blocks
- Incomplete OAuth flow in the connector UI

The HTTP tunnel is ready and waiting: `https://brain.bhavya-second-brain.online/mcp?auth=TOKEN`

Will work once Anthropic fixes their custom connector implementation (still in beta).

---

## Security Considerations

### What's protected
- All MCP endpoints require valid auth token
- Failed auth triggers progressive ban (5 failures = 1 hour)
- Rate limiting prevents abuse (100 req/min per IP)
- All requests logged with IP, method, path, status

### What's NOT protected
- Health endpoint (`GET /health`) is publicly accessible (intentional for monitoring)
- Stdio mode has no authentication (trusted local process)
- Ban list and rate limits are in-memory (reset on restart)
- No TLS at the server level (handled by Cloudflare tunnel)

### Threat model
- **Remote attack via tunnel**: Mitigated by auth token + rate limit + auto-ban
- **Local attack**: Not in scope — if attacker has local access, they have the .env file
- **Token leak**: Single token, rotate via .env change + restart
- **DDoS**: Rate limiting provides basic protection; Cloudflare provides edge DDoS mitigation
