/**
 * Subagent Manager plugin — frontend entry point.
 *
 * Monitors Claude Code subagents from agent-*.jsonl files.
 * Polls the backend server every 3 seconds for updates.
 */

import type { PluginAPI, PluginContext } from './types.js';

// ── Types ──────────────────────────────────────────────────────────────

interface AgentEntry {
  agentId: string;
  shortId: string;
  model: string;
  status: 'running' | 'complete' | 'error';
  toolCount: number;
  turns: number;
  firstMessage: string;
  cwd: string;
  sessionId: string;
  slug: string;
  startTime: number;
  lastTime: number;
  fileSize: number;
}

interface AgentListResponse {
  agents: AgentEntry[];
  projectPath: string | null;
}

// ── Theme ─────────────────────────────────────────────────────────────

interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  running: string;
  complete: string;
  error: string;
  mono: string;
}

function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        bg: '#08080f',
        surface: '#0e0e1a',
        border: '#1a1a2c',
        text: '#e2e0f0',
        muted: '#52507a',
        accent: '#fbbf24',
        running: '#34d399',
        complete: '#60a5fa',
        error: '#f43f5e',
        mono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      }
    : {
        bg: '#fafaf9',
        surface: '#ffffff',
        border: '#e8e6f0',
        text: '#0f0e1a',
        muted: '#9490b0',
        accent: '#d97706',
        running: '#059669',
        complete: '#2563eb',
        error: '#dc2626',
        mono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      };
}

// ── Helpers ────────────────────────────────────────────────────────────

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function modelBadge(model: string): string {
  if (model.includes('claude')) return 'claude';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('mini') || model.includes('minimax')) return 'minimax';
  if (model.includes('gemini')) return 'gemini';
  if (model.includes('cursor')) return 'cursor';
  if (model.includes('codex')) return 'codex';
  return 'model';
}

function statusDot(status: AgentEntry['status'], c: ThemeColors): string {
  const color = status === 'running' ? c.running : status === 'error' ? c.error : c.complete;
  return `<span style="
    display:inline-block;width:7px;height:7px;border-radius:50%;
    background:${color};
    ${status === 'running' ? 'animation:sm-pulse 2s ease-in-out infinite' : ''}
  "></span>`;
}

// ── Styles ─────────────────────────────────────────────────────────────

function ensureStyles(): void {
  if (document.getElementById('sm-styles')) return;
  const s = document.createElement('style');
  s.id = 'sm-styles';
  s.textContent = `
    @keyframes sm-pulse {
      0%,100% { opacity:1 }
      50% { opacity:0.35 }
    }
    @keyframes sm-fadeup {
      from { opacity:0; transform:translateY(8px) }
      to   { opacity:1; transform:translateY(0) }
    }
    @keyframes sm-spin {
      to { transform:rotate(360deg) }
    }
    .sm-up { animation: sm-fadeup 0.35s ease both }
  `;
  document.head.appendChild(s);
}

// ── Render ─────────────────────────────────────────────────────────────

function renderAgents(root: HTMLElement, ctx: PluginContext, data: AgentListResponse | null, loading: boolean): void {
  const c = themeColors(ctx.theme === 'dark');
  root.style.background = c.bg;
  root.style.color = c.text;
  root.style.fontFamily = c.mono;

  // Preserve scroll position across re-renders
  const contentEl = root.querySelector('#sm-content');
  const savedScrollTop = contentEl ? (contentEl as HTMLElement).scrollTop : root.scrollTop;

  // Header
  let headerHtml = `
    <div style="
      display:flex;align-items:center;justify-content:space-between;
      padding:20px 24px 16px;
      border-bottom:1px solid ${c.border};
    ">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem;font-weight:700;letter-spacing:-0.02em">
          Subagents
        </span>
  `;

  if (loading) {
    headerHtml += `
      <span style="
        display:inline-block;width:12px;height:12px;
        border:1.5px solid ${c.muted};
        border-top-color:${c.accent};
        border-radius:50%;
        animation:sm-spin 0.7s linear infinite;
      "></span>
    `;
  }
  headerHtml += `</div>`;

  if (data && data.projectPath) {
    headerHtml += `
      <div style="
        font-size:0.65rem;color:${c.muted};
        max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      " title="${data.projectPath}">
        ${data.agents.length} agent${data.agents.length !== 1 ? 's' : ''} found
      </div>
    `;
  }
  headerHtml += `</div>`;

  // Content
  let contentHtml = `<div id="sm-content" style="padding:16px 24px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;height:calc(100% - 60px)">`;

  if (!ctx.project) {
    contentHtml += `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:50%;gap:12px;color:${c.muted};text-align:center;
      ">
        <pre style="font-size:0.72rem;opacity:0.4;line-height:1.6">
.no project selected
subagents are tracked per project</pre>
        <div style="font-size:0.68rem;letter-spacing:0.1em;text-transform:uppercase;opacity:0.5">
          select a project
        </div>
      </div>
    `;
  } else if (loading && !data) {
    // Skeleton
    for (let i = 0; i < 3; i++) {
      contentHtml += `
        <div style="
          background:${c.surface};border:1px solid ${c.border};
          border-radius:6px;padding:14px 16px;
        ">
          <div style="
            height:10px;background:${c.muted};border-radius:2px;opacity:0.25;
            width:${65 + (i * 11) % 30}%;margin-bottom:10px;
            animation:sm-pulse 1.6s ease infinite;animation-delay:${i * 0.15}s
          "></div>
          <div style="
            height:8px;background:${c.muted};border-radius:2px;opacity:0.15;
            width:${40 + (i * 17) % 40}%;
            animation:sm-pulse 1.6s ease infinite;animation-delay:${i * 0.15 + 0.1}s
          "></div>
        </div>
      `;
    }
  } else if (data && data.agents.length === 0) {
    contentHtml += `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:40%;gap:10px;color:${c.muted};text-align:center;
      ">
        <div style="font-size:2rem;opacity:0.15">${'{' }/${'}'}</div>
        <div style="font-size:0.75rem;opacity:0.5">no subagents in this project</div>
        <div style="font-size:0.65rem;opacity:0.3;max-width:260px;line-height:1.5;margin-top:4px">
          subagents spawn when a Task tool is invoked
        </div>
      </div>
    `;
  } else if (data) {
    for (let i = 0; i < data.agents.length; i++) {
      const agent = data.agents[i];
      const badge = modelBadge(agent.model);
      const isRunning = agent.status === 'running';
      const dot = statusDot(agent.status, c);
      const delay = Math.min(i * 0.04, 0.3);

      contentHtml += `
        <div class="sm-up" style="
          background:${c.surface};border:1px solid ${c.border};
          border-radius:6px;padding:14px 16px;
          animation-delay:${delay}s;
          ${isRunning ? `border-left:2px solid ${c.running}` : ''}
          transition:border-color 0.15s;
        ">
          <!-- Top row: status + badge + model -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              ${dot}
              <span style="
                font-size:0.6rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;
                color:${agent.status === 'running' ? c.running : agent.status === 'error' ? c.error : c.complete};
              ">${agent.status}</span>
              <span style="
                font-size:0.58rem;font-weight:500;padding:2px 6px;
                background:${c.bg};border:1px solid ${c.border};
                border-radius:3px;color:${c.muted};
              ">${agent.shortId}</span>
            </div>
            <span style="
              font-size:0.6rem;padding:2px 7px;
              background:${c.bg};border:1px solid ${c.border};
              border-radius:3px;color:${c.muted};
              max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
            " title="${agent.model}">${agent.model}</span>
          </div>

          <!-- Prompt -->
          <div style="
            font-size:0.72rem;line-height:1.5;color:${c.text};opacity:0.85;
            margin-bottom:10px;word-break:break-word;
          ">${agent.firstMessage}</div>

          <!-- Meta row -->
          <div style="
            display:flex;align-items:center;gap:16px;
            font-size:0.62rem;color:${c.muted};
          ">
            <span title="tool executions">⚙ ${agent.toolCount}</span>
            <span title="assistant turns">↻ ${agent.turns}</span>
            <span title="session slug">/ ${agent.slug || agent.sessionId.slice(0, 8)}</span>
            <span style="margin-left:auto">${ago(agent.lastTime)}</span>
          </div>
        </div>
      `;
    }
  }

  contentHtml += `</div>`;

  root.innerHTML = `<div style="height:100%;overflow:hidden;display:flex;flex-direction:column">${headerHtml}${contentHtml}</div>`;

  // Restore scroll position after re-render
  const newContent = root.querySelector('#sm-content');
  if (newContent) {
    newContent.scrollTop = savedScrollTop;
  } else {
    root.scrollTop = savedScrollTop;
  }
}

// ── Mount / Unmount ────────────────────────────────────────────────────

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function mount(container: HTMLElement, api: PluginAPI): void {
  ensureStyles();

  const root = document.createElement('div');
  Object.assign(root.style, {
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  });
  container.appendChild(root);

  let cached: AgentListResponse | null = null;
  let loading = false;
  let currentPath: string | null = null;
  let firstLoad = true;

  async function loadAgents(): Promise<void> {
    const ctx = api.context;
    const projectPath = ctx.project?.path ?? null;

    if (projectPath === currentPath && cached) {
      renderAgents(root, ctx, cached, false);
      return;
    }

    if (!projectPath) {
      currentPath = null;
      cached = null;
      renderAgents(root, ctx, null, false);
      return;
    }

    // Only show skeleton on first load — keep old content visible during project changes
    if (firstLoad) {
      loading = true;
      firstLoad = false;
    }
    currentPath = projectPath;
    renderAgents(root, ctx, cached, loading);

    try {
      const data = (await api.rpc('GET', `agents?path=${encodeURIComponent(projectPath)}`)) as AgentListResponse;
      cached = data;
      loading = false;
      renderAgents(root, ctx, data, false);
    } catch (err) {
      loading = false;
      const c = themeColors(ctx.theme === 'dark');
      renderAgents(root, ctx, cached, false);
      root.innerHTML = `
        <div style="
          padding:24px;font-size:0.75rem;color:${c.error};opacity:0.85;
          font-family:${c.mono};
        ">✗ ${(err as Error).message}</div>
      `;
    }
  }

  loadAgents();

  // Poll every 3 seconds
  pollInterval = setInterval(loadAgents, 3000);

  // React to context changes
  const unsubscribe = api.onContextChange(() => {
    currentPath = null; // force reload on project change
    loadAgents();
  });

  (container as any)._smUnsubscribe = unsubscribe;
}

export function unmount(container: HTMLElement): void {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (typeof (container as any)._smUnsubscribe === 'function') {
    (container as any)._smUnsubscribe();
    delete (container as any)._smUnsubscribe;
  }
  container.innerHTML = '';
}
