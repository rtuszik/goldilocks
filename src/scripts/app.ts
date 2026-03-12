interface ResourceMap {
  cpu?: string;
  memory?: string;
}

interface ContainerData {
  Requests?: ResourceMap;
  LowerBound?: ResourceMap;
  UpperBound?: ResourceMap;
  Target?: ResourceMap;
  Limits?: ResourceMap;
}

interface WorkloadData {
  ControllerType?: string;
  Containers?: Record<string, ContainerData>;
}

interface NamespaceData {
  Namespace?: string;
  Workloads?: Record<string, WorkloadData>;
}

type Status = 'over' | 'under' | 'optimal' | 'unknown';

// ─── Global YAML store ────────────────────────────────────────────────────────
const _yaml: Record<string, string> = {};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  namespaces: [] as string[],
  selected: null as string | null,
  data: null as NamespaceData | null,
  loading: false,
  filter: '',
};

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function loadNamespaces(): Promise<void> {
  try {
    state.namespaces = await apiFetch<string[]>('/api/namespaces');
  } catch (e) {
    const nav = document.getElementById('sidebar-nav');
    if (nav) nav.innerHTML = `<div style="padding:1rem;color:#ef4444;font-size:0.78rem">Failed to load namespaces:<br>${esc(e)}</div>`;
    return;
  }
  renderSidebar();
}

async function loadNamespace(ns: string): Promise<void> {
  state.selected = ns;
  state.data = null;
  state.loading = true;
  renderSidebar();
  renderContent();

  try {
    type NSResponse = { Namespaces?: Record<string, NamespaceData> } | NamespaceData;
    const json = await apiFetch<NSResponse>('/api/' + encodeURIComponent(ns));
    const maybe = json as { Namespaces?: Record<string, NamespaceData> };
    state.data = maybe.Namespaces?.[ns] ?? (json as NamespaceData);
    state.loading = false;
    renderContent();
  } catch (e) {
    state.loading = false;
    const content = document.getElementById('content');
    if (content) content.innerHTML = `<div class="error-box">Failed to load data for <strong>${esc(ns)}</strong>: ${esc(e)}</div>`;
  }
}

// ─── Resource quantity parsing ────────────────────────────────────────────────
function parseCPU(qty?: string): number {
  if (!qty) return 0;
  qty = qty.trim();
  if (qty.endsWith('m')) return parseInt(qty, 10) || 0;
  if (qty.endsWith('n')) return (parseInt(qty, 10) || 0) / 1e6;
  if (qty.endsWith('u')) return (parseInt(qty, 10) || 0) / 1e3;
  const n = parseFloat(qty);
  return isNaN(n) ? 0 : Math.round(n * 1000);
}

function parseMemory(qty?: string): number {
  if (!qty) return 0;
  qty = qty.trim();
  const suffixes: Record<string, number> = {
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
    K: 1e3,   M: 1e6,        G: 1e9,         T: 1e12,
  };
  for (const [s, m] of Object.entries(suffixes)) {
    if (qty.endsWith(s)) {
      const n = parseFloat(qty);
      return isNaN(n) ? 0 : n * m;
    }
  }
  return parseInt(qty, 10) || 0;
}

function formatCPU(mc: number): string {
  if (!mc || mc <= 0) return '—';
  if (mc < 1000) return Math.round(mc) + 'm';
  const cores = mc / 1000;
  return cores % 1 === 0 ? String(cores) : cores.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatMemory(b: number): string {
  if (!b || b <= 0) return '—';
  if (b >= 1024 ** 3) {
    const v = b / 1024 ** 3;
    return (v % 1 === 0 ? String(v) : v.toFixed(1).replace(/\.0$/, '')) + 'Gi';
  }
  if (b >= 1024 ** 2) return Math.round(b / 1024 ** 2) + 'Mi';
  if (b >= 1024) return Math.round(b / 1024) + 'Ki';
  return b + 'B';
}

// ─── Status calculation ───────────────────────────────────────────────────────
function resourceStatus(current: number, lower: number, upper: number): Status {
  if (upper <= 0) return 'unknown';
  if (current <= 0) return lower > 0 ? 'under' : 'unknown';
  if (current < lower * 0.75) return 'under';
  if (current > upper * 1.5) return 'over';
  return 'optimal';
}

function containerStatus(c: ContainerData): Status {
  const cpuS = resourceStatus(
    parseCPU(c.Requests?.cpu),
    parseCPU(c.LowerBound?.cpu),
    parseCPU(c.UpperBound?.cpu),
  );
  const memS = resourceStatus(
    parseMemory(c.Requests?.memory),
    parseMemory(c.LowerBound?.memory),
    parseMemory(c.UpperBound?.memory),
  );
  const rank: Record<Status, number> = { over: 3, under: 2, optimal: 1, unknown: 0 };
  return rank[cpuS] >= rank[memS] ? cpuS : memS;
}

const STATUS_LABEL: Record<Status, string> = {
  over:    '▼ Over-provisioned',
  under:   '▲ Under-provisioned',
  optimal: '✓ Optimal',
  unknown: '? No data',
};

// ─── YAML builders ────────────────────────────────────────────────────────────
function guaranteedYAML(c: ContainerData): string {
  const cpu = c.Target?.cpu    ?? '—';
  const mem = c.Target?.memory ?? '—';
  return [
    'resources:',
    '  requests:',
    `    cpu: "${cpu}"`,
    `    memory: "${mem}"`,
    '  limits:',
    `    cpu: "${cpu}"`,
    `    memory: "${mem}"`,
  ].join('\n');
}

function burstableYAML(c: ContainerData): string {
  return [
    'resources:',
    '  requests:',
    `    cpu: "${c.LowerBound?.cpu    ?? '—'}"`,
    `    memory: "${c.LowerBound?.memory ?? '—'}"`,
    '  limits:',
    `    cpu: "${c.UpperBound?.cpu    ?? '—'}"`,
    `    memory: "${c.UpperBound?.memory ?? '—'}"`,
  ].join('\n');
}

// ─── HTML escaping ────────────────────────────────────────────────────────────
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Resource bar ─────────────────────────────────────────────────────────────
function barHTML(label: string, current: number, lower: number, upper: number, target: number, limits: number): string {
  const fmt = label === 'CPU' ? formatCPU : formatMemory;
  const max = Math.max(limits, upper, current) * 1.15 || target * 2 || 1;

  const status  = resourceStatus(current, lower, upper);
  const fillPct = Math.min((current / max) * 100, 100).toFixed(1);
  const tgtPct  = target > 0 ? Math.min((target / max) * 100, 100).toFixed(1) : null;

  const marker = tgtPct
    ? `<div class="resource-bar-marker" style="left:${tgtPct}%" title="Target: ${fmt(target)}"></div>`
    : '';

  const fill = current > 0
    ? `<div class="resource-bar-fill ${status}" style="width:${fillPct}%"></div>`
    : `<div class="resource-bar-fill unknown" style="width:0%"></div>`;

  return `
    <div class="resource-row">
      <span class="resource-label">${label}</span>
      <div class="resource-bar-track">${fill}${marker}</div>
      <div class="resource-values">
        <span class="rv-current">${esc(fmt(current))}</span>
        <span class="rv-arrow">→</span>
        <span class="rv-target">${esc(fmt(target))}</span>
      </div>
    </div>`;
}

// ─── Container ────────────────────────────────────────────────────────────────
function containerHTML(name: string, c: ContainerData): string {
  const status = containerStatus(c);

  const cpuReq  = parseCPU(c.Requests?.cpu);
  const cpuLow  = parseCPU(c.LowerBound?.cpu);
  const cpuHigh = parseCPU(c.UpperBound?.cpu);
  const cpuTgt  = parseCPU(c.Target?.cpu);
  const cpuLim  = parseCPU(c.Limits?.cpu);

  const memReq  = parseMemory(c.Requests?.memory);
  const memLow  = parseMemory(c.LowerBound?.memory);
  const memHigh = parseMemory(c.UpperBound?.memory);
  const memTgt  = parseMemory(c.Target?.memory);
  const memLim  = parseMemory(c.Limits?.memory);

  const uid  = Math.random().toString(36).slice(2, 10);
  const gKey = 'g' + uid;
  const bKey = 'b' + uid;
  _yaml[gKey] = guaranteedYAML(c);
  _yaml[bKey] = burstableYAML(c);

  return `
    <div class="container-section">
      <div class="container-header">
        <span class="container-name" title="${esc(name)}">${esc(name)}</span>
        <span class="status-badge ${status}">${STATUS_LABEL[status]}</span>
      </div>
      <div class="resource-bars">
        ${barHTML('CPU', cpuReq, cpuLow, cpuHigh, cpuTgt, cpuLim)}
        ${barHTML('MEM', memReq, memLow, memHigh, memTgt, memLim)}
      </div>
      <div class="yaml-actions">
        <button class="yaml-btn" data-toggle-panel="panel-${gKey}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Guaranteed YAML
        </button>
        <button class="yaml-btn" data-toggle-panel="panel-${bKey}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Burstable YAML
        </button>
      </div>
      <div id="panel-${gKey}" class="yaml-panel">
        <div class="yaml-code-wrap">
          <pre class="yaml-pre">${esc(_yaml[gKey])}</pre>
          <button class="yaml-copy" data-yaml-key="${gKey}">Copy</button>
        </div>
      </div>
      <div id="panel-${bKey}" class="yaml-panel">
        <div class="yaml-code-wrap">
          <pre class="yaml-pre">${esc(_yaml[bKey])}</pre>
          <button class="yaml-copy" data-yaml-key="${bKey}">Copy</button>
        </div>
      </div>
    </div>`;
}

// ─── Workload card ────────────────────────────────────────────────────────────
function typeBadgeClass(t?: string): string {
  return t && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'].includes(t)
    ? 'tb-' + t
    : 'tb-default';
}

function workloadHTML(name: string, w: WorkloadData): string {
  const containers = w.Containers ?? {};
  const cNames = Object.keys(containers).sort();
  const containersHTML = cNames.map(cn => containerHTML(cn, containers[cn]!)).join('');

  return `
    <div class="workload-card">
      <div class="workload-header">
        <span class="workload-name" title="${esc(name)}">${esc(name)}</span>
        <span class="type-badge ${typeBadgeClass(w.ControllerType)}">${esc(w.ControllerType ?? 'Unknown')}</span>
        <span class="workload-count">${cNames.length} container${cNames.length !== 1 ? 's' : ''}</span>
      </div>
      <div>${containersHTML}</div>
    </div>`;
}

// ─── Stats bar ────────────────────────────────────────────────────────────────
function statsHTML(workloads: Record<string, WorkloadData>): string {
  let total = 0, over = 0, under = 0, optimal = 0;
  for (const w of Object.values(workloads)) {
    for (const c of Object.values(w.Containers ?? {})) {
      total++;
      const s = containerStatus(c);
      if (s === 'over') over++;
      else if (s === 'under') under++;
      else if (s === 'optimal') optimal++;
    }
  }
  return `
    <div class="stats-bar">
      <div class="stat-card"><span class="stat-value">${total}</span><span class="stat-label">Containers</span></div>
      <div class="stat-card s-over"><span class="stat-value">${over}</span><span class="stat-label">Over-provisioned</span></div>
      <div class="stat-card s-under"><span class="stat-value">${under}</span><span class="stat-label">Under-provisioned</span></div>
      <div class="stat-card s-optimal"><span class="stat-value">${optimal}</span><span class="stat-label">Optimal</span></div>
    </div>`;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar(): void {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  if (!state.namespaces.length) {
    nav.innerHTML = `<div style="padding:1rem;color:#64748b;font-size:0.78rem">
      No namespaces found.<br>
      <span style="color:#475569">Label a namespace with<br><code style="font-size:0.72rem">goldilocks.fairwinds.com/enabled=true</code></span>
    </div>`;
    return;
  }

  const icon = `<svg class="ns-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 10h6M9 14h4"/></svg>`;

  nav.innerHTML = `
    <div class="nav-section-title">Namespaces</div>
    ${state.namespaces.map(ns => `
      <div class="ns-item${ns === state.selected ? ' active' : ''}"
           data-ns="${esc(ns)}"
           title="${esc(ns)}"
           role="button"
           aria-current="${ns === state.selected ? 'page' : 'false'}">
        ${icon}${esc(ns)}
      </div>`).join('')}`;
}

// ─── Main content ─────────────────────────────────────────────────────────────
function renderContent(): void {
  const content = document.getElementById('content');
  const title   = document.getElementById('topbar-title');
  if (!content || !title) return;

  if (!state.selected) {
    title.textContent = 'Goldilocks';
    content.innerHTML = `
      <div class="empty-state">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h4"/>
        </svg>
        <h3>Select a namespace</h3>
        <p>Choose a namespace from the sidebar to view VPA recommendations.</p>
      </div>`;
    return;
  }

  title.textContent = state.selected;

  if (state.loading) {
    content.innerHTML = `
      <div class="loading-wrap">
        <div class="spinner"></div>
        <span>Loading ${esc(state.selected)}…</span>
      </div>`;
    return;
  }

  if (!state.data) return;

  const workloads = state.data.Workloads ?? {};
  const all       = Object.keys(workloads).sort();
  const filtered  = state.filter
    ? all.filter(n => n.toLowerCase().includes(state.filter.toLowerCase()))
    : all;

  if (!all.length) {
    content.innerHTML = `
      <div class="empty-state">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <h3>No workloads found</h3>
        <p>No VPA-enabled workloads in <strong>${esc(state.selected)}</strong>.<br>
           Make sure VPAs exist and recommendations have been generated.</p>
      </div>`;
    return;
  }

  let html = statsHTML(workloads);

  if (!filtered.length) {
    html += `<div class="empty-state" style="padding:2rem">
      <p>No workloads match "<strong>${esc(state.filter)}</strong>"</p>
    </div>`;
  } else {
    html += `<div class="workloads-grid">`;
    for (const n of filtered) html += workloadHTML(n, workloads[n]!);
    html += `</div>`;
  }

  content.innerHTML = html;
}

// ─── Event delegation ─────────────────────────────────────────────────────────
document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  const nsItem = target.closest<HTMLElement>('[data-ns]');
  if (nsItem?.dataset.ns) {
    const ns = nsItem.dataset.ns;
    if (ns !== state.selected) loadNamespace(ns);
    return;
  }

  const toggleBtn = target.closest<HTMLElement>('[data-toggle-panel]');
  if (toggleBtn?.dataset.togglePanel) {
    const panel = document.getElementById(toggleBtn.dataset.togglePanel);
    if (panel) {
      const open = panel.classList.toggle('visible');
      toggleBtn.classList.toggle('open', open);
    }
    return;
  }

  const copyBtn = target.closest<HTMLElement>('[data-yaml-key]');
  if (copyBtn?.dataset.yamlKey) {
    const key  = copyBtn.dataset.yamlKey;
    const text = _yaml[key] ?? '';

    const onSuccess = (): void => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => { fallbackCopy(text); onSuccess(); });
    } else {
      fallbackCopy(text);
      onSuccess();
    }
  }
});

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

document.getElementById('filter-input')?.addEventListener('input', (e: Event) => {
  state.filter = (e.target as HTMLInputElement).value;
  renderContent();
});

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  if (state.selected) loadNamespace(state.selected);
  else loadNamespaces();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadNamespaces();
