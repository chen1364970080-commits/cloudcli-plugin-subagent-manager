# CloudCLI Plugin: Subagent Manager

A sidebar tab plugin for [Claude Code](https://claude.ai/code) that monitors Claude Code subagents in real time.

## What It Does

When Claude Code spawns subagents via the `Task` tool, this plugin tracks them — showing live status (running/complete/error), model, tool execution counts, turn counts, and session details. Auto-refreshes every 3 seconds with scroll position preserved.

## Features

- **Live status tracking** — Pulsing green dot = running, blue = complete, red = error
- **Auto-refresh** — Polls every 3 seconds, preserves scroll position
- **Per-project isolation** — Tracks agents for the currently selected project
- **Rich metadata** — Model badge, tool execution count, assistant turns, session slug
- **Dark + light themes** — Automatic theme switching

## Architecture

```
subagent-manager/
├── manifest.json       # Plugin descriptor (name, entry, server, slot)
├── src/
│   ├── server.ts       # Backend HTTP server (Node.js)
│   │                    # Scans ~/.claude/projects/<hash>/subagents/
│   │                    # Parses agent-*.jsonl → JSON → HTTP API
│   ├── index.ts        # Frontend (vanilla JS, polling every 3s)
│   └── types.ts        # PluginAPI / PluginContext type definitions
├── dist/               # Compiled output (tsc)
├── icon.svg            # Plugin icon
├── package.json
└── tsconfig.json
```

## How the Backend Works

The server scans the subagent JSONL files written by Claude Code:

```
~/.claude/projects/<project-hash>/subagents/agent-<sessionId>.jsonl
```

Each JSONL entry contains the full conversation turn. The server parses the most recent entry to determine status:
- **running** — last entry has a tool-use or assistant message without final human ack
- **complete** — last entry is a human turn or explicit stop
- **error** — error markers in the entry

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents?path=<projectPath>` | GET | List all agents for the given project path |
| `/health` | GET | Server health check |

### Response: `/agents`

```json
{
  "agents": [
    {
      "agentId": "abc123-def456",
      "shortId": "abc1234",
      "model": "claude-opus-4-7",
      "status": "running",
      "toolCount": 42,
      "turns": 8,
      "firstMessage": "Analyze the codebase for...",
      "cwd": "/path/to/project",
      "sessionId": "abc123-def456-...",
      "slug": "repo-review",
      "startTime": 1745712000000,
      "lastTime": 1745712340000,
      "fileSize": 8192
    }
  ],
  "projectPath": "/path/to/project"
}
```

## Installation

```bash
# 1. Clone or copy the plugin
git clone https://github.com/chen1364970080-commits/cloudcli-plugin-subagent-manager.git

# 2. Install into Claude Code plugins directory
cp -r cloudcli-plugin-subagent-manager ~/.claude-code-ui/plugins/subagent-manager

# 3. Build
cd ~/.claude-code-ui/plugins/subagent-manager
npm install
npm run build

# 4. Restart Claude Code — the "Subagents" tab appears in the sidebar
```

## Requirements

- Claude Code with plugin support (UI v2+)
- Node.js (the backend server uses native Node APIs)

## Plugin API

This plugin uses the CloudCLI Plugin API:

```typescript
interface PluginContext {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
}

interface PluginAPI {
  readonly context: PluginContext;
  onContextChange(callback: (ctx: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
}

mount(container: HTMLElement, api: PluginAPI): void;
unmount(container: HTMLElement): void;
```

## Key Design Decisions

- **No framework** — vanilla JS + CSS for the frontend. No React/Vue/Svelte dependency.
- **Poll-based** — 3-second polling interval. No WebSocket since the backend is a simple HTTP server.
- **Per-project isolation** — agents are scoped to the currently selected project via `?path=` query param.
- **Scroll preservation** — saves/restores `scrollTop` across re-renders so users don't jump to the top on refresh.

## License

MIT
