# Subagent Manager Plugin

CloudCLI UI plugin that monitors Claude Code subagents from agent-*.jsonl files.

## Build

```bash
npm install
npm run build
```

## Files

- `src/server.ts` — HTTP backend, scans subagent JSONL files
- `src/index.ts` — Frontend UI, polls server every 3s
- `src/types.ts` — PluginAPI type definitions
- `dist/` — Compiled TypeScript output
