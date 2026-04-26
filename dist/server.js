/**
 * Subagent Manager plugin — backend HTTP server.
 *
 * Reads agent-*.jsonl files from Claude Code project subdirectories
 * and exposes them via a simple HTTP API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// ── Helpers ────────────────────────────────────────────────────────────
function getClaudeProjectsDir() {
    return path.join(os.homedir(), '.claude', 'projects');
}
function truncate(str, maxLen) {
    const s = str.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}
function parseAgentLine(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
function detectStatus(entries) {
    if (entries.length === 0)
        return 'complete';
    const last = entries[entries.length - 1];
    const msg = last['message'];
    if (!msg)
        return 'complete';
    const content = msg['content'];
    if (Array.isArray(content)) {
        const hasError = content.some((block) => block && typeof block === 'object' &&
            block['type'] === 'tool_result' &&
            block['is_error'] === true);
        if (hasError)
            return 'error';
        const lastBlock = content[content.length - 1];
        if (lastBlock && lastBlock['type'] === 'tool_result') {
            return 'complete';
        }
        const stopReason = msg['stop_reason'];
        if (stopReason === 'end_turn' || stopReason === 'stop_sequence')
            return 'complete';
        if (stopReason === null && last['type'] === 'assistant')
            return 'running';
    }
    return 'complete';
}
function getStopReason(obj) {
    const msg = obj['message'];
    if (!msg)
        return null;
    return msg['stop_reason'] ?? null;
}
function getModel(entry) {
    const msg = entry['message'];
    if (!msg)
        return 'unknown';
    return msg['model'] ?? 'unknown';
}
function getFirstUserMessage(entries) {
    for (const entry of entries) {
        if (entry['type'] === 'user') {
            const msg = entry['message'];
            if (!msg)
                continue;
            const content = msg['content'];
            if (typeof content === 'string' && content.trim()) {
                return truncate(content, 120);
            }
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block && typeof block === 'object' && block['type'] === 'text') {
                        const text = block['text'] ?? '';
                        if (text.trim())
                            return truncate(text, 120);
                    }
                }
            }
        }
    }
    return '(no prompt)';
}
function getAgentInfo(filePath) {
    let content;
    let fileSize = 0;
    try {
        const stat = fs.statSync(filePath);
        fileSize = stat.size;
        content = fs.readFileSync(filePath, 'utf-8');
    }
    catch {
        return null;
    }
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0)
        return null;
    const entries = [];
    for (const line of lines) {
        const parsed = parseAgentLine(line);
        if (parsed)
            entries.push(parsed);
    }
    if (entries.length === 0)
        return null;
    const first = entries[0];
    const last = entries[entries.length - 1];
    const agentId = first['agentId'] ?? '';
    const shortId = agentId.length > 8 ? agentId.slice(0, 8) : agentId;
    const cwd = first['cwd'] ?? '';
    const sessionId = first['sessionId'] ?? '';
    const slug = first['slug'] ?? '';
    const startTime = new Date(first['timestamp'] ?? Date.now()).getTime();
    const lastTime = new Date(last['timestamp'] ?? Date.now()).getTime();
    const model = getModel(first);
    const status = detectStatus(entries);
    const toolCount = entries.filter((e) => {
        const msg = e['message'];
        if (!msg)
            return false;
        const content = msg['content'];
        if (!Array.isArray(content))
            return false;
        return content.some((b) => b && typeof b === 'object' && b['type'] === 'tool_use');
    }).length;
    const turns = entries.filter((e) => e['type'] === 'assistant').length;
    const firstMessage = getFirstUserMessage(entries);
    return {
        agentId,
        shortId,
        model,
        status,
        toolCount,
        turns,
        firstMessage,
        cwd,
        sessionId,
        slug,
        startTime,
        lastTime,
        fileSize,
    };
}
function getAgentsForProject(projectPath) {
    const subagentsDir = path.join(projectPath, 'subagents');
    let dirEntries;
    try {
        dirEntries = fs.readdirSync(subagentsDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const agents = [];
    for (const entry of dirEntries) {
        if (!entry.isFile() || !entry.name.startsWith('agent-') || !entry.name.endsWith('.jsonl')) {
            continue;
        }
        const info = getAgentInfo(path.join(subagentsDir, entry.name));
        if (info)
            agents.push(info);
    }
    // Sort: running first, then by lastTime descending
    agents.sort((a, b) => {
        if (a.status === 'running' && b.status !== 'running')
            return -1;
        if (a.status !== 'running' && b.status === 'running')
            return 1;
        return b.lastTime - a.lastTime;
    });
    return agents;
}
function getAgentList(projectPath) {
    if (!projectPath) {
        return { agents: [], projectPath: null };
    }
    if (!path.isAbsolute(projectPath)) {
        return { agents: [], projectPath: null };
    }
    return { agents: getAgentsForProject(projectPath), projectPath };
}
// ── HTTP server ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url) {
        const urlPath = req.url.split('?')[0];
        // GET /agents?path=<projectPath>
        if (urlPath === '/agents' || urlPath === '/agents/') {
            try {
                const { searchParams } = new URL(req.url, 'http://localhost');
                const projectPath = searchParams.get('path') ?? '';
                const result = getAgentList(projectPath || undefined);
                res.end(JSON.stringify(result));
            }
            catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }
        // GET /health
        if (urlPath === '/health') {
            res.end(JSON.stringify({ ok: true }));
            return;
        }
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr !== 'string') {
        console.log(JSON.stringify({ ready: true, port: addr.port }));
    }
});
//# sourceMappingURL=server.js.map