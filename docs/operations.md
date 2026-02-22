# Operations Guide

> Build, run, deploy, backup, Cloudflare tunnel, system tray, environment setup.

## Prerequisites

- **Node.js 22+** (for ESM support and prebuilt native binaries)
- **npm** (comes with Node.js)
- **Windows 11** (primary platform — most tooling is Windows-specific)

No C++ build tools needed — `better-sqlite3-multiple-ciphers` has prebuilt binaries for Node 22.

## Environment Setup

### 1. Clone the code repo

```bash
git clone <repo-url> "E:\Project Second Brain\project-brain"
```

### 2. Create the data directory

```bash
mkdir "E:\Project Second Brain\brain-data\dbs"
mkdir "E:\Project Second Brain\brain-data\logs"
```

### 3. Configure environment

```bash
cd "E:\Project Second Brain\project-brain"
cp .env.example .env
```

Edit `.env`:
```env
BRAIN_PASSWORD=<strong-encryption-password>
AUTH_TOKEN=<random-auth-token>
BRAIN_DATA_PATH=E:/Project Second Brain/brain-data/dbs
```

**Critical**: Use **forward slashes** in `BRAIN_DATA_PATH` on Windows. Backslashes get eaten by the shell.

### 4. Install dependencies

```bash
npm install
```

### 5. Build

```bash
npm run build
```

### 6. Seed founding values

```bash
node dist/seed.js
```

This loads the 11 founding values and 17 hard constraints into `core.db`. Idempotent — safe to run multiple times.

---

## Running

### Claude Code (stdio mode)

```bash
node dist/index.js --stdio
```

Or via npm:
```bash
npm run start:stdio
```

Claude Code connects to this via the MCP server config. No authentication needed.

### HTTP server (for Claude.ai)

```bash
node dist/index.js
```

Or via npm:
```bash
npm start
```

Starts Express on port 3577 with full security stack. Requires Cloudflare tunnel for external access.

### Development (watch mode)

```bash
npm run dev
```

Runs `tsc --watch` — recompiles on file changes. You still need to restart the server manually.

---

## Claude Code MCP Configuration

Add to Claude Code's MCP config:

```json
{
  "mcpServers": {
    "project-brain": {
      "command": "node",
      "args": ["E:/Project Second Brain/project-brain/dist/index.js", "--stdio"],
      "env": {
        "BRAIN_PASSWORD": "<password>",
        "BRAIN_DATA_PATH": "E:/Project Second Brain/brain-data/dbs"
      }
    }
  }
}
```

### Claude Desktop Configuration

Config at `C:\Users\jainb\AppData\Roaming\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "project-brain": {
      "command": "node",
      "args": ["E:/Project Second Brain/project-brain/dist/index.js", "--stdio"],
      "env": {
        "BRAIN_PASSWORD": "<password>",
        "BRAIN_DATA_PATH": "E:/Project Second Brain/brain-data/dbs"
      }
    }
  }
}
```

---

## Cloudflare Tunnel

### Setup

The tunnel is already configured. Key details:

- **Domain**: `brain.bhavya-second-brain.online`
- **Tunnel ID**: `af7a35f0-fb1e-4c5d-86c2-4d5dbe2d9c74`
- **Binary**: `C:\Program Files (x86)\cloudflared\cloudflared.exe` (v2025.8.1)
- **Config**: `C:\Users\jainb\.cloudflared\config.yml`
- **Installed as**: Windows service (`cloudflared service install`)

### Config file

```yaml
# C:\Users\jainb\.cloudflared\config.yml
tunnel: af7a35f0-fb1e-4c5d-86c2-4d5dbe2d9c74
credentials-file: C:\Users\jainb\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: brain.bhavya-second-brain.online
    service: http://localhost:3577
  - service: http_status:404
```

### Managing the tunnel

```powershell
# Check tunnel status
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel info af7a35f0-fb1e-4c5d-86c2-4d5dbe2d9c74

# Restart the service
Restart-Service cloudflared

# View logs
Get-Content "C:\Users\jainb\.cloudflared\cloudflared.log" -Tail 50
```

---

## Backup System

### Code repo (`project-brain`)

Standard git workflow. Push to remote as needed.

**Rule**: Only push `project-brain` (code). NEVER push `brain-data`.

### Data repo (`brain-data`)

Auto-backup via PowerShell script:

- **Script**: `brain-data/backup.ps1`
- **Schedule**: Every 4 hours via Windows Task Scheduler
- **Method**: Copies encrypted DB files to backup location

**The databases are encrypted at rest** — the backup files are also encrypted. No plaintext data ever touches disk.

---

## System Tray (Auto-Start)

The `tray/` directory contains scripts for running the HTTP server as a background process with system tray icon:

| File | Purpose |
|------|---------|
| `brain-tray.ps1` | PowerShell script that manages the server process and tray icon |
| `brain-tray.bat` | Batch wrapper for the PowerShell script |
| `brain-tray.vbs` | VBScript wrapper (hides console window) |
| `install-startup.ps1` | Registers with Windows Task Scheduler for auto-start |
| `uninstall-startup.ps1` | Removes the auto-start task |

### Install auto-start

```powershell
cd "E:\Project Second Brain\project-brain\tray"
.\install-startup.ps1
```

### Uninstall auto-start

```powershell
.\uninstall-startup.ps1
```

---

## Troubleshooting

### Database shows as "data" not "SQLite"

This is correct. Encrypted SQLite databases appear as generic "data" files to the `file` command. The encryption is working.

### "Cannot open database" errors

Check:
1. `BRAIN_DATA_PATH` uses forward slashes
2. `BRAIN_PASSWORD` matches what was used to create the DBs
3. The `dbs/` directory exists

### Embedding model download stalls

First call to `batch_embed`, `hybrid_search`, or `semantic_search` downloads ~90MB. If it stalls:
1. Check internet connectivity
2. Check HuggingFace cache directory for partial downloads
3. Delete cache and retry

### Rate limit hit during development

Rate limiter is in-memory. Restart the server to reset.

### "Session not found" errors

Sessions are in-memory. Server restart clears all sessions. Client must start a new session.

### sqlite-vec load fails

Ensure sqlite-vec is loaded BEFORE the encryption pragma in `connection.ts`. The extension must register its virtual table module before the database is unlocked.

---

## Health Monitoring

```bash
curl http://localhost:3577/health
```

Returns:
```json
{
  "status": "ok",
  "server": "project-brain",
  "version": "1.0.0",
  "sessions": 0,
  "uptime": 3600.5
}
```

No authentication required. Use for monitoring scripts or uptime checks.

---

## Security Log Analysis

```bash
# Recent entries
tail -20 "E:\Project Second Brain\brain-data\logs\security.log"

# Failed auth attempts
grep "AUTH_FAILED" "E:\Project Second Brain\brain-data\logs\security.log"

# Banned IPs
grep "IP_BANNED" "E:\Project Second Brain\brain-data\logs\security.log"

# Rate limited requests
grep "RATE_LIMITED" "E:\Project Second Brain\brain-data\logs\security.log"
```

Log format is JSON lines — one JSON object per line, amenable to `jq` processing.
