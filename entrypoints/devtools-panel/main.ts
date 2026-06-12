// "NetDigest" panel: display and export only. Network capture lives in the
// devtools page (entrypoints/devtools/main.ts), which attaches NETDIGEST_BRIDGE here.
import './style.css';
import { encode } from '@toon-format/toon';
import {
  DETAIL_LEVELS,
  recompactEntry,
  type CompactEntry,
  type CompactLimits,
  type DetailLevel,
} from '@/utils/compact';
import { buildApiMap } from '@/utils/apimap';
import { isApiLike, isSameSite, type BridgeWindow, type HarBridge } from '@/utils/bridge';

const API_TYPES = new Set(['xhr', 'fetch']);
const MAX_PREVIEW = 50; // max entries encoded in the preview (the export is always complete)
const SETTINGS_KEY = 'netdigest-settings';
const OVERRIDES_KEY = 'netdigest-overrides';

// Prepended to every export: explains the markers to the model reading the capture.
const PREAMBLE = [
  '# DevTools network capture in TOON format (Token-Oriented Object Notation).',
  '# Markers: "…[truncated, N chars total]" = string cut; "…[+N items, M total]" = array cut;',
  '# "…[object, N keys]" / "…[array, N items]" = nested content cut at the depth limit;',
  '# "…[same as X]" = value identical to sibling X; "…[base64/binary …]" = binary reduced;',
  '# array items after the first only show fields that differ from item 0',
  '# ("…": "[N keys same as item 0]" = those N keys repeat item 0 values);',
  '# "***" = redacted secret; "count" = identical calls merged (same method+URL+status);',
  '# "initiator" = the app code (file:line:col + function/hook) that triggered the call;',
  '# "type: marker" rows are timeline steps recorded from user interactions',
  '# (page, clicks, form submits, navigations): each step explains the requests that follow it.',
].join('\n');

const MAP_PREAMBLE = [
  '# Condensed API map derived from captured DevTools traffic (TOON format).',
  '# Endpoints are normalized (/articles/42 → /articles/:id); "calls" sums identical requests;',
  '# request/response are first-seen examples, heavily truncated; "***" = redacted secret.',
].join('\n');

let bridge: HarBridge | null = null;
const selection = new Set<CompactEntry>();
let anchor: CompactEntry | null = null; // starting point for Shift+click ranges
let detail: DetailLevel = 'M';
let apiMapView: string | null = null; // pinned API-map preview (until Esc/click/clear)

const listEl = document.getElementById('list')!;
const previewEl = document.getElementById('preview')!;
const countEl = document.getElementById('count')!;
const apiOnlyEl = document.getElementById('api-only') as HTMLInputElement;
const sameSiteEl = document.getElementById('same-site') as HTMLInputElement;
const headersEl = document.getElementById('headers') as HTMLInputElement;
const flowOnlyEl = document.getElementById('flow-only') as HTMLInputElement;
const uniqueEl = document.getElementById('unique') as HTMLInputElement;
const searchEl = document.getElementById('search') as HTMLInputElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const leftEl = document.getElementById('left')!;
const resizerEl = document.getElementById('resizer')!;
const segEl = document.getElementById('detail')!;
const ovBarEl = document.getElementById('override')!;
const ovItemsEl = document.getElementById('ov-items') as HTMLInputElement;
const ovDepthEl = document.getElementById('ov-depth') as HTMLInputElement;
const ovCharsEl = document.getElementById('ov-chars') as HTMLInputElement;

// ---- Native theme: DevTools theme when readable, system preference otherwise ----

function applyTheme() {
  let devtoolsTheme: string | undefined;
  try {
    devtoolsTheme = (
      globalThis as { chrome?: { devtools?: { panels?: { themeName?: string } } } }
    ).chrome?.devtools?.panels?.themeName;
  } catch {
    // no devtools API in this context → system fallback
  }
  const dark = devtoolsTheme
    ? devtoolsTheme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// Any problem becomes visible in the panel itself - no need to inspect its console.
window.addEventListener('error', (e) => {
  previewEl.textContent = `Panel error: ${e.message}`;
});
window.addEventListener('unhandledrejection', (e) => {
  previewEl.textContent = `Panel error: ${String(e.reason)}`;
});

// ---- Persistent settings (panel localStorage) ----

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    apiOnlyEl.checked = s.apiOnly ?? true;
    sameSiteEl.checked = s.sameSite ?? true;
    headersEl.checked = s.headers ?? false;
    flowOnlyEl.checked = s.flowOnly ?? false;
    uniqueEl.checked = s.unique ?? false;
    searchEl.value = s.search ?? '';
    if (s.detail in DETAIL_LEVELS) detail = s.detail;
    if (typeof s.leftWidth === 'number') setLeftWidth(s.leftWidth);
  } catch {
    // corrupted settings → defaults
  }
  syncDetailButtons();
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      apiOnly: apiOnlyEl.checked,
      sameSite: sameSiteEl.checked,
      headers: headersEl.checked,
      flowOnly: flowOnlyEl.checked,
      unique: uniqueEl.checked,
      search: searchEl.value,
      detail,
      leftWidth: leftEl.style.width ? Math.round(leftEl.getBoundingClientRect().width) : null,
    }),
  );
}

// ---- Per-endpoint overrides (persisted) ----
// "This endpoint deserves more": items/depth/chars set manually for one endpoint
// (method + URL without query), applied on top of the S/M/L level everywhere.

interface EndpointOverride {
  items?: number;
  depth?: number;
  chars?: number;
}

let overrides: Record<string, EndpointOverride> = {};

function loadOverrides() {
  try {
    overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '{}');
  } catch {
    overrides = {};
  }
}

function saveOverrides() {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

function overrideKeyOf(e: CompactEntry): string {
  return `${e.method} ${e.url.split('?')[0]}`;
}

function limitsFor(e: CompactEntry): CompactLimits {
  const base = DETAIL_LEVELS[detail];
  const o = e.type === 'marker' ? undefined : overrides[overrideKeyOf(e)];
  if (!o) return base;
  return {
    ...base,
    array: o.items ?? base.array,
    depth: o.depth ?? base.depth,
    string: o.chars ?? base.string,
  };
}

function readOverrideInput(input: HTMLInputElement): number | undefined {
  const n = Number.parseInt(input.value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function applyOverrideFromBar() {
  const value: EndpointOverride = {
    items: readOverrideInput(ovItemsEl),
    depth: readOverrideInput(ovDepthEl),
    chars: readOverrideInput(ovCharsEl),
  };
  const empty = value.items === undefined && value.depth === undefined && value.chars === undefined;
  for (const e of selectedEntries()) {
    if (e.type === 'marker') continue;
    const key = overrideKeyOf(e);
    if (empty) delete overrides[key];
    else overrides[key] = value;
  }
  saveOverrides();
  render();
}

function syncOverrideBar(sel: CompactEntry[]) {
  const targets = sel.filter((e) => e.type !== 'marker');
  ovBarEl.hidden = targets.length === 0;
  if (!targets.length) return;
  const base = DETAIL_LEVELS[detail];
  const o = overrides[overrideKeyOf(targets[0])] ?? {};
  ovItemsEl.value = o.items?.toString() ?? '';
  ovDepthEl.value = o.depth?.toString() ?? '';
  ovCharsEl.value = o.chars?.toString() ?? '';
  ovItemsEl.placeholder = String(base.array);
  ovDepthEl.placeholder = String(base.depth);
  ovCharsEl.placeholder = String(base.string);
}

ovItemsEl.addEventListener('change', applyOverrideFromBar);
ovDepthEl.addEventListener('change', applyOverrideFromBar);
ovCharsEl.addEventListener('change', applyOverrideFromBar);

const ovCopyBtn = document.getElementById('ov-copy') as HTMLButtonElement;
ovCopyBtn.addEventListener('click', async () => {
  // Copy the preview exactly as shown - override applied, no preamble.
  await copyText(previewEl.textContent ?? '');
  flash(ovCopyBtn, 'copied ✓');
});

document.getElementById('ov-clear')!.addEventListener('click', () => {
  for (const e of selectedEntries()) {
    if (e.type !== 'marker') delete overrides[overrideKeyOf(e)];
  }
  saveOverrides();
  render();
});

// ---- Detail level (S/M/L) segmented control ----

function syncDetailButtons() {
  for (const btn of segEl.querySelectorAll('button')) {
    btn.classList.toggle('on', btn.dataset.level === detail);
  }
}

segEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const level = btn?.dataset.level as DetailLevel | undefined;
  if (!level || !(level in DETAIL_LEVELS)) return;
  detail = level;
  syncDetailButtons();
  saveSettings();
  render();
});

// ---- Pane resizing ----

function setLeftWidth(px: number) {
  // keep 200px on each side so both panes stay usable
  const clamped = Math.max(200, Math.min(px, document.body.clientWidth - 200));
  leftEl.style.width = `${clamped}px`;
}

resizerEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizerEl.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
});

resizerEl.addEventListener('pointermove', (e) => {
  if (!resizerEl.hasPointerCapture(e.pointerId)) return;
  setLeftWidth(e.clientX - leftEl.getBoundingClientRect().left);
});

const endResize = (e: PointerEvent) => {
  if (!resizerEl.hasPointerCapture(e.pointerId)) return;
  resizerEl.releasePointerCapture(e.pointerId);
  document.body.classList.remove('resizing');
  saveSettings();
};
resizerEl.addEventListener('pointerup', endResize);
resizerEl.addEventListener('pointercancel', endResize);

// double-click: back to the default width (46%)
resizerEl.addEventListener('dblclick', () => {
  leftEl.style.width = '';
  saveSettings();
});

// keyboard accessibility: ← → arrows while the handle has focus
resizerEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setLeftWidth(leftEl.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 24 : -24));
  saveSettings();
});

// ---- Connection to the capture side ----

// The devtools page attaches the bridge via panel.onShown; poll until it shows up.
let connectAttempts = 0;
function connect() {
  const found = (window as BridgeWindow).NETDIGEST_BRIDGE;
  if (!found) {
    connectAttempts++;
    if (connectAttempts === 20) {
      // 2s without a bridge: the devtools page predates the extension reload
      countEl.textContent = 'capture bridge not found: close and reopen DevTools';
    }
    setTimeout(connect, 100);
    return;
  }
  bridge = found;
  bridge.onChange = scheduleRender;
  render();
}

// Captures arrive in bursts (page reloads): coalesce renders per frame.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---- Selection / filters / export ----

function entries(): CompactEntry[] {
  return bridge?.entries ?? [];
}

function visibleEntries(): CompactEntry[] {
  const terms = searchEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pageHost = bridge?.pageHost ?? null;
  const flowOnly = flowOnlyEl.checked;
  const seenPaths = uniqueEl.checked ? new Set<string>() : null;
  const out: CompactEntry[] = [];
  for (const e of entries()) {
    if (e.type === 'marker') {
      // markers ignore type/domain filters; search matches their label
      if (!terms.length || terms.every((t) => `marker ${e.url}`.toLowerCase().includes(t))) out.push(e);
      continue;
    }
    if (flowOnly) continue; // flow = recorded actions only, no requests
    if (apiOnlyEl.checked) {
      if (!API_TYPES.has(e.type)) continue;
      // errors are ALWAYS kept: a 500 returning an HTML error page is still API debugging gold
      const isError = e.status >= 400 || e.status === 0;
      if (!isError && !isApiLike(e.mimeType)) continue;
    }
    if (sameSiteEl.checked && !isSameSite(e.url, pageHost)) continue;
    if (terms.length) {
      const haystack = `${e.method} ${e.status} ${e.type} ${e.url}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) continue;
    }
    if (seenPaths) {
      // collapse query-param variations: keep only the first per method + URL path
      const key = overrideKeyOf(e);
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
    }
    out.push(e);
  }
  return out;
}

/** Selected entries (capture order), even when the current filter hides them. */
function selectedEntries(): CompactEntry[] {
  return entries().filter((e) => selection.has(e));
}

/** Export = the selection when there is one, otherwise everything the filter shows. */
function exportEntries(): CompactEntry[] {
  const sel = selectedEntries();
  return sel.length ? sel : visibleEntries();
}

// Entries are created in the devtools page realm; recompactEntry rebuilds every
// container in the panel realm (otherwise the TOON encoder outputs "null").
// structuredClone stays as a cheap extra safety net.
function toonEncode(value: unknown): string {
  return encode(structuredClone(value));
}

function exportList(list: CompactEntry[]): unknown[] {
  return list.map((e) => recompactEntry(e, limitsFor(e), headersEl.checked));
}

/** One line telling the model where/when this traffic comes from. */
function contextHeader(list: CompactEntry[]): string {
  const real = list.filter((e) => e.type !== 'marker');
  const host = bridge?.pageHost ?? 'unknown host';
  if (!real.length) return `# Captured from ${host}.`;
  const times = real.map((e) => e.startedDateTime).sort();
  return `# Captured from ${host}, ${times[0]} → ${times[times.length - 1]}, ${real.length} unique requests.`;
}

function exportToon(): string {
  const list = exportEntries();
  return `${PREAMBLE}\n${contextHeader(list)}\n\n${toonEncode(exportList(list))}`;
}

/** Removes rows from the capture (dedup index cleaned capture-side). */
function removeEntries(list: CompactEntry[]) {
  if (!bridge || !list.length) return;
  if (typeof bridge.remove === 'function') {
    bridge.remove(list);
  } else {
    // stale bridge without remove(): best-effort splice
    const doomed = new Set(list);
    for (let i = bridge.entries.length - 1; i >= 0; i--) {
      if (doomed.has(bridge.entries[i])) bridge.entries.splice(i, 1);
    }
  }
  for (const e of list) selection.delete(e);
  if (anchor && list.includes(anchor)) anchor = null;
  render();
}

function onRowClick(entry: CompactEntry, ev: MouseEvent) {
  apiMapView = null;
  const visible = visibleEntries();
  if (ev.shiftKey && anchor) {
    const a = visible.indexOf(anchor);
    const b = visible.indexOf(entry);
    if (a !== -1 && b !== -1) {
      if (!ev.ctrlKey && !ev.metaKey) selection.clear();
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) selection.add(visible[i]);
    }
  } else if (ev.ctrlKey || ev.metaKey) {
    if (selection.has(entry)) selection.delete(entry);
    else selection.add(entry);
    anchor = entry;
  } else {
    selection.clear();
    selection.add(entry);
    anchor = entry;
  }
  render();
  previewEl.scrollTop = 0; // show the preview from its first selected request
}

// ---- Rendering ----

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function render() {
  const all = entries();
  const visible = visibleEntries();
  const sel = selectedEntries();
  const exported = exportEntries();
  const tokens = exported.length ? Math.round(exportToon().length / 4) : 0;
  const ovCount = new Set(
    exported.filter((e) => e.type !== 'marker').map(overrideKeyOf).filter((k) => overrides[k]),
  ).size;

  countEl.textContent = bridge
    ? `${visible.length} shown / ${all.length} captured` +
      (sel.length ? ` • ${sel.length} selected (Esc to clear)` : '') +
      (tokens ? ` • ≈ ${fmtTokens(tokens)} tokens` : '') +
      (ovCount ? ` • ${ovCount} endpoint override${ovCount > 1 ? 's' : ''}` : '') +
      (bridge.dropped ? ` (${bridge.dropped} oldest purged)` : '') +
      (bridge.recording ? ' · ● REC' : ' · listening ✓')
    : 'connecting to capture…';

  syncOverrideBar(sel);

  recBtn.classList.toggle('recording', !!bridge?.recording);
  const recLabel = recBtn.querySelector('.btn-label');
  if (recLabel) recLabel.textContent = bridge?.recording ? 'REC' : 'Record';

  listEl.replaceChildren(
    ...visible.map((entry) => {
      const li = document.createElement('li');
      li.classList.toggle('selected', selection.has(entry));
      if (entry.type === 'marker') {
        li.classList.add('marker');
        const label = el('span', 'url', entry.url);
        label.title = entry.startedDateTime;
        li.append(el('span', 'flag', '⚑'), label);
      } else {
        const ok = entry.status >= 200 && entry.status < 400;
        const url = el('span', 'url', entry.url);
        url.title = entry.url;
        li.append(
          el('span', 'method', entry.method),
          el('span', `status ${ok ? 'ok' : 'err'}`, String(entry.status)),
        );
        if (entry.count && entry.count > 1) li.append(el('span', 'dup', `×${entry.count}`));
        li.append(url, el('span', 'time', `${entry.time} ms`));
      }
      const rm = el('button', 'rm', '×') as HTMLButtonElement;
      rm.title = 'Remove this row (Del removes the whole selection)';
      rm.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeEntries([entry]);
      });
      li.append(rm);
      li.addEventListener('click', (ev) => onRowClick(entry, ev));
      return li;
    }),
  );

  previewEl.classList.toggle('placeholder', !sel.length && !apiMapView && !bridge?.error);
  if (sel.length) {
    const shown = exportList(sel.slice(0, MAX_PREVIEW));
    const header = sel.length > 1 ? `# ${sel.length} selected requests: Copy/Download exports them all\n` : '';
    const frag = highlightToon(header + toonEncode(shown));
    if (sel.length > MAX_PREVIEW) {
      frag.append(
        span(
          't-comment',
          `\n… preview limited to ${MAX_PREVIEW} requests, the TOON export will include all ${sel.length}.`,
        ),
      );
    }
    previewEl.replaceChildren(frag);
  } else if (apiMapView) {
    previewEl.replaceChildren(highlightToon(apiMapView));
  } else if (bridge?.error) {
    previewEl.textContent = `⚠ ${bridge.error}`;
  } else if (all.length === 0) {
    previewEl.textContent =
      'No requests captured since DevTools opened.\n' +
      'Reload the target page (F5) or trigger a network action: requests will show up here.';
  } else if (visible.length === 0) {
    previewEl.textContent = searchEl.value.trim()
      ? 'No requests match the filter.'
      : 'Nothing passes the filters. Uncheck "API only" or "same domain" to see everything.';
  } else {
    previewEl.textContent =
      'Click a request to preview it.\n' +
      'Ctrl+click: add/remove • Shift+click: range • Esc: clear • Del: remove rows.\n' +
      'Copy/Download TOON exports the selection, or everything filtered when nothing is selected.';
  }
}

function el(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function flash(btn: HTMLButtonElement, label: string) {
  // only swap the label, keep the SVG icon
  const target = btn.querySelector('.btn-label') ?? btn;
  const original = target.textContent;
  target.textContent = label;
  setTimeout(() => (target.textContent = original), 1200);
}

// ---- TOON syntax highlighting ----

const VALUE_TOKEN = /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[,\s]|$)|\b(true|false|null)\b|(…\[[^\]]*\])/g;
const LINE_RE = /^(\s*)(- )?((?:"[^"]*")|[^\s:"[{]+)?(\[\d+\])?(\{[^}]*\})?(:)(\s|$)([\s\S]*)$/;

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function highlightValue(value: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const m of value.matchAll(VALUE_TOKEN)) {
    if (m.index > last) nodes.push(document.createTextNode(value.slice(last, m.index)));
    if (m[1]) nodes.push(span('t-str', m[1]));
    else if (m[2]) nodes.push(span('t-num', m[2]));
    else if (m[3]) nodes.push(span('t-kw', m[3]));
    else nodes.push(span('t-dim', m[4]));
    last = m.index + m[0].length;
  }
  if (last < value.length) nodes.push(document.createTextNode(value.slice(last)));
  return nodes;
}

function highlightLine(line: string): Node[] {
  if (/^\s*#/.test(line)) return [span('t-comment', line)];
  const m = LINE_RE.exec(line);
  if (!m) {
    // line without a "key:" → tabular row ("1,Alice,admin") or list item
    const dash = /^(\s*- )([\s\S]*)$/.exec(line);
    if (dash) return [span('t-dim', dash[1]), ...highlightValue(dash[2])];
    return highlightValue(line);
  }
  const [, indent, dash, key, count, fields, colon, sp, rest] = m;
  const nodes: Node[] = [document.createTextNode(indent)];
  if (dash) nodes.push(span('t-dim', dash));
  if (key) nodes.push(span('t-key', key));
  if (count) nodes.push(span('t-meta', count));
  if (fields) nodes.push(span('t-fields', fields));
  nodes.push(span('t-dim', colon), document.createTextNode(sp), ...highlightValue(rest));
  return nodes;
}

function highlightToon(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    frag.append(...highlightLine(line));
    if (i < lines.length - 1) frag.append(document.createTextNode('\n'));
  });
  return frag;
}

// ---- Actions ----

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback when the async clipboard is denied inside the panel
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

copyBtn.addEventListener('click', async () => {
  await copyText(exportToon());
  flash(copyBtn, 'Copied ✓');
});

const apiMapBtn = document.getElementById('api-map') as HTMLButtonElement;
apiMapBtn.addEventListener('click', async () => {
  const list = exportEntries();
  const map = buildApiMap(list);
  apiMapView = `${MAP_PREAMBLE}\n${contextHeader(list)}\n\n${toonEncode(map)}`;
  selection.clear();
  anchor = null;
  render();
  await copyText(apiMapView);
  flash(apiMapBtn, 'Copied ✓');
});

const recBtn = document.getElementById('record') as HTMLButtonElement;
recBtn.addEventListener('click', () => {
  if (!bridge?.setRecording) {
    previewEl.textContent = 'Recorder unavailable: close and reopen DevTools to refresh the capture side.';
    return;
  }
  bridge.setRecording(!bridge.recording);
  render();
});

document.getElementById('download')!.addEventListener('click', () => {
  const blob = new Blob([exportToon()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `netdigest-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.toon`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('clear')!.addEventListener('click', () => {
  if (bridge) {
    if (typeof bridge.reset === 'function') bridge.reset();
    else {
      bridge.entries.length = 0;
      bridge.dropped = 0;
      bridge.error = null;
    }
  }
  selection.clear();
  anchor = null;
  apiMapView = null;
  render();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    selection.clear();
    anchor = null;
    apiMapView = null;
    render();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    removeEntries(selectedEntries());
  }
});

const onFilterChange = () => {
  saveSettings();
  render();
};
apiOnlyEl.addEventListener('change', onFilterChange);
sameSiteEl.addEventListener('change', onFilterChange);
headersEl.addEventListener('change', onFilterChange);
flowOnlyEl.addEventListener('change', onFilterChange);
uniqueEl.addEventListener('change', onFilterChange);
searchEl.addEventListener('input', onFilterChange);

loadOverrides();
loadSettings();
render();
connect();
