// DevTools page: captures the network as soon as DevTools opens (even before
// the panel is first shown) and pushes compacted entries to the panel.
// Identical calls (method+URL+status) are merged into a single ×N entry.
// Capture keeps a generous detail level; the panel re-truncates at export time.
// Also hosts the interaction recorder: when armed, clicks/submits/navigations
// on the inspected page become timeline "marker" steps.
import { capUrl, compactBody, CAPTURE_LIMITS, type CompactEntry } from '@/utils/compact';
import { hostOf, isToolingNoise, MAX_ENTRIES, type BridgeWindow, type HarBridge } from '@/utils/bridge';
import { buildInitiator, pickFrames, type HarInitiator, type StackFrame } from '@/utils/initiator';
import { cleanSourcePath, findSourceMappingURL, resolveInMap, type RawSourceMap } from '@/utils/sourcemap';

// Minimal shape of the object provided by devtools.network.onRequestFinished
// (HAR entry + getContent). Typed locally to stay browser-agnostic.
interface HarHeader {
  name: string;
  value: string;
}

interface DevtoolsRequest {
  startedDateTime: string;
  time: number;
  _resourceType?: string;
  _initiator?: HarInitiator;
  request: { method: string; url: string; headers?: HarHeader[]; postData?: { text?: string } };
  response: { status: number; headers?: HarHeader[]; content?: { size?: number; mimeType?: string } };
  getContent(callback: (content: string | null, encoding: string) => void): void;
}

// Headers worth keeping for debugging (CORS, caching, tracing). Auth/cookies are
// deliberately NOT captured - they never even reach memory.
const HEADER_WHITELIST = new Set([
  'cache-control',
  'content-encoding',
  'etag',
  'retry-after',
  'www-authenticate',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'x-request-id',
  'x-trace-id',
  'x-correlation-id',
]);

function pickHeaders(list?: HarHeader[]): Record<string, string> | undefined {
  if (!list?.length) return undefined;
  let out: Record<string, string> | undefined;
  for (const h of list) {
    const name = h.name.toLowerCase();
    if (HEADER_WHITELIST.has(name)) (out ??= {})[name] = h.value.slice(0, 128);
  }
  return out;
}

const index = new Map<string, CompactEntry>(); // dedup key → entry
const keyOf = (e: CompactEntry) => `${e.method} ${e.status} ${e.url}`;

const bridge: HarBridge = {
  entries: [],
  dropped: 0,
  error: null,
  onChange: null,
  pageHost: null,
  recording: false,
  remove(list: CompactEntry[]) {
    const doomed = new Set(list);
    for (let i = bridge.entries.length - 1; i >= 0; i--) {
      const e = bridge.entries[i];
      if (doomed.has(e)) {
        bridge.entries.splice(i, 1);
        if (e.type !== 'marker') index.delete(keyOf(e));
      }
    }
  },
  reset() {
    bridge.entries.length = 0;
    bridge.dropped = 0;
    bridge.error = null;
    index.clear();
  },
};

function notify() {
  try {
    bridge.onChange?.();
  } catch {
    // panel closed/reloaded: keep buffering silently
    bridge.onChange = null;
  }
}

function trimBuffer() {
  while (bridge.entries.length > MAX_ENTRIES) {
    const removed = bridge.entries.shift()!;
    if (removed.type !== 'marker') index.delete(keyOf(removed));
    bridge.dropped++;
  }
}

function push(entry: CompactEntry): boolean {
  const key = keyOf(entry);
  const existing = index.get(key);
  if (existing) {
    // Already seen: keep the first sample, bump the counter.
    existing.count = (existing.count ?? 1) + 1;
    notify();
    return false;
  }
  index.set(key, entry);
  bridge.entries.push(entry);
  trimBuffer();
  notify();
  return true;
}

// ---- Initiator source snippets ----
// The page's scripts are readable through devtools getResources() - no extra
// permission. Contents are cached per URL and dropped on navigation.

const sourceCache = new Map<string, Promise<string | null>>();

function getSource(url?: string): Promise<string | null> {
  if (!url || !/^https?:/i.test(url)) return Promise.resolve(null);
  let cached = sourceCache.get(url);
  if (!cached) {
    cached = new Promise((resolve) => {
      try {
        (browser.devtools.inspectedWindow as unknown as {
          getResources(cb: (resources: Array<{ url: string; getContent(cb2: (content: string | null) => void): void }>) => void): void;
        }).getResources((resources) => {
          const res = resources?.find((r) => r.url === url);
          if (!res) return resolve(null); // e.g. service-worker scripts are not page resources
          res.getContent((content) => resolve(typeof content === 'string' ? content : null));
        });
      } catch {
        resolve(null);
      }
    });
    sourceCache.set(url, cached);
    if (sourceCache.size > 50) sourceCache.delete(sourceCache.keys().next().value!);
  }
  return cached;
}

// ---- Source maps: map bundled frames back to the original TS/JS files ----
// Dev servers embed sourcesContent in their maps, so we can show the user's
// real code. External .map files are fetched FROM THE PAGE (same-origin) via
// an eval-polled fetch - the devtools page itself would be blocked by CORS.

let fetchSeq = 0;
function fetchInPage(url: string): Promise<string | null> {
  if (!inspected) return Promise.resolve(null);
  const id = `__netdigestFetch${++fetchSeq}`;
  const expr = `(function(){
    if (!window.${id}) {
      window.${id} = { d: 0, v: null };
      fetch(${JSON.stringify(url)})
        .then(function(r){ return r.ok ? r.text() : null; })
        .then(function(t){ window.${id} = { d: 1, v: (t && t.length < 25000000) ? t : null }; })
        .catch(function(){ window.${id} = { d: 1, v: null }; });
    }
    var s = window.${id};
    if (s.d) { try { delete window.${id}; } catch(_e) {} return s.v; }
    return '__pending__';
  })()`;
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      inspected!.eval(expr, (result, err) => {
        if (err) return resolve(null);
        if (result === '__pending__') {
          if (++tries > 40) return resolve(null); // ~12s cap
          setTimeout(tick, 300);
          return;
        }
        resolve(typeof result === 'string' ? result : null);
      });
    };
    tick();
  });
}

function decodeBase64Utf8(b64: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

const mapCache = new Map<string, Promise<RawSourceMap | null>>();

function getSourceMap(chunkUrl: string, chunkContent: string): Promise<RawSourceMap | null> {
  let cached = mapCache.get(chunkUrl);
  if (!cached) {
    cached = (async () => {
      const ref = findSourceMappingURL(chunkContent);
      if (!ref) return null;
      let text: string | null;
      if (ref.startsWith('data:')) {
        text = decodeBase64Utf8(ref.slice(ref.indexOf(',') + 1));
      } else {
        try {
          text = await fetchInPage(new URL(ref, chunkUrl).href);
        } catch {
          return null;
        }
      }
      if (!text) return null;
      try {
        const map = JSON.parse(text) as RawSourceMap;
        return map && typeof map.mappings === 'string' && Array.isArray(map.sources) ? map : null;
      } catch {
        return null;
      }
    })();
    mapCache.set(chunkUrl, cached);
    if (mapCache.size > 20) mapCache.delete(mapCache.keys().next().value!);
  }
  return cached;
}

/** Original-source label for a frame, via its source map; null when unmappable. */
async function resolveFrameLabel(frame: StackFrame): Promise<string | null> {
  if (!frame.url) return null;
  const content = await getSource(frame.url);
  if (!content) return null;
  const map = await getSourceMap(frame.url, content);
  if (!map) return null;
  const hit = resolveInMap(map, frame.lineNumber ?? 0, frame.columnNumber ?? 0);
  const source = hit ? map.sources[hit.srcIdx] : null;
  if (!hit || source == null) return null;
  const path = cleanSourcePath((map.sourceRoot ?? '') + source);
  return `${path}:${hit.origLine + 1}:${hit.origCol + 1}${frame.functionName ? ` (${frame.functionName})` : ''}`;
}

function attachSourceLabel(entry: CompactEntry, raw: HarInitiator | undefined) {
  // The export keeps a single initiator line (via): remap the app frame - the
  // hook/caller - to its original source file; fall back to the call site.
  const { top, app } = pickFrames(raw);
  const frame = app ?? top;
  if (!entry.initiator || !frame?.url) return;
  void resolveFrameLabel(frame).then((label) => {
    if (label) {
      entry.initiator!.via = label;
      notify();
    }
  });
}

/** Inserts a timeline step at its chronological position (before the requests it triggered). */
function pushMarker(label: string, atMs?: number) {
  const at = new Date(atMs ?? Date.now()).toISOString();
  const entry: CompactEntry = {
    type: 'marker',
    method: 'MARK',
    url: label,
    status: 0,
    time: 0,
    startedDateTime: at,
    requestBody: null,
    responseBody: null,
  };
  let i = bridge.entries.length;
  while (i > 0 && bridge.entries[i - 1].startedDateTime > at) i--;
  bridge.entries.splice(i, 0, entry);
  trimBuffer();
  notify();
}

function setPageHost(host: string | null) {
  if (bridge.pageHost !== host) {
    bridge.pageHost = host;
    notify();
  }
}

// ---- Network capture ----

try {
  browser.devtools.network.onRequestFinished.addListener((raw: unknown) => {
    const req = raw as DevtoolsRequest;
    // tooling noise (source maps incl. our own fetches, RSC payloads, manifests)
    if (isToolingNoise(req.request.url, req.response.content?.mimeType)) return;
    // Push immediately: getContent's callback sometimes never fires (failed
    // requests, redirects, SW responses) and must not make entries vanish.
    const entry: CompactEntry = {
      startedDateTime: req.startedDateTime,
      time: Math.round(req.time),
      type: req._resourceType ?? 'other',
      method: req.request.method,
      url: capUrl(req.request.url),
      status: req.response.status,
      mimeType: req.response.content?.mimeType,
      responseSize: req.response.content?.size,
      initiator: buildInitiator(req._initiator),
      requestHeaders: pickHeaders(req.request.headers),
      responseHeaders: pickHeaders(req.response.headers),
      requestBody: compactBody(req.request.postData?.text, undefined, CAPTURE_LIMITS),
      responseBody: null,
    };
    const isNew = push(entry);
    if (isNew) attachSourceLabel(entry, req._initiator);
    if (!isNew) return; // dedup kept the first sample
    try {
      req.getContent((content, encoding) => {
        const body = compactBody(content, encoding, CAPTURE_LIMITS);
        if (body !== null) {
          entry.responseBody = body;
          notify();
        }
      });
    } catch {
      // body unavailable: the entry stays, responseBody remains null
    }
  });
} catch (err) {
  bridge.error = `devtools.network API unavailable: ${String(err)}`;
}

// ---- Access to the inspected page (hostname + interaction recorder) ----

interface InspectedWindow {
  eval(expr: string, cb: (result: unknown, err?: unknown) => void): void;
}

let inspected: InspectedWindow | null = null;
try {
  inspected = browser.devtools.inspectedWindow as unknown as InspectedWindow;
} catch {
  inspected = null; // not blocking: same-domain filter lets all through, recorder unavailable
}

inspected?.eval('location.hostname', (result) => {
  setPageHost(typeof result === 'string' && result ? result.toLowerCase() : null);
});

try {
  browser.devtools.network.onNavigated.addListener((url: string) => {
    sourceCache.clear(); // page scripts changed
    mapCache.clear();
    setPageHost(hostOf(url));
    if (bridge.recording) {
      pushMarker(`navigate ${url.slice(0, 200)}`);
      installRecorder(); // the page reloaded: listeners are gone, re-arm
    }
  });
} catch {
  // no navigation events → recorder still re-arms via drain-null detection
}

// ---- Interaction recorder ----
// Injected into the inspected page via inspectedWindow.eval (no content script,
// no extra permission). Events are buffered in-page and drained every 500ms.

const RECORDER_INSTALL = `(function(){
  if (window.__netdigestRecorder) return 'already';
  var buf = [];
  var ACTIONABLE = 'a,button,[role="button"],input[type="submit"],input[type="button"],input[type="checkbox"],input[type="radio"],select,summary,[onclick]';
  function labelOf(t){
    var s = (t.innerText || t.value || (t.getAttribute && (t.getAttribute('aria-label') || t.getAttribute('title') || t.getAttribute('name'))) || '');
    s = String(s).replace(/\\s+/g, ' ').trim().slice(0, 60);
    if (!s && t.tagName === 'A') s = (t.getAttribute('href') || '').slice(0, 60);
    return s;
  }
  function record(e){ buf.push(e); if (buf.length > 100) buf.shift(); }
  function onClick(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest(ACTIONABLE) : null;
    if (!t) return;
    var tag = t.tagName.toLowerCase();
    if (tag === 'input') tag = t.type || 'input';
    var e = { kind: 'click', tag: tag, label: labelOf(t), at: Date.now() };
    if (t.tagName === 'A') e.href = (t.getAttribute('href') || '').slice(0, 120);
    record(e);
  }
  function onSubmit(ev){
    var f = ev.target;
    var name = (f.getAttribute && (f.getAttribute('id') || f.getAttribute('name') || f.getAttribute('action'))) || 'form';
    record({ kind: 'submit', tag: 'form', label: String(name).slice(0, 80), at: Date.now() });
  }
  // SPA route changes (pushState/replaceState/popstate) - invisible to devtools onNavigated
  var lastNav = location.href;
  function pushNav(){
    if (location.href === lastNav) return;
    lastNav = location.href;
    record({ kind: 'navigate', label: location.href.slice(0, 200), at: Date.now() });
  }
  var origPush = history.pushState, origReplace = history.replaceState;
  history.pushState = function(){ var r = origPush.apply(this, arguments); try { pushNav(); } catch(_e){} return r; };
  history.replaceState = function(){ var r = origReplace.apply(this, arguments); try { pushNav(); } catch(_e){} return r; };
  function onPop(){ pushNav(); }
  window.addEventListener('popstate', onPop);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  window.__netdigestRecorder = {
    drain: function(){ return buf.splice(0); },
    stop: function(){
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', onPop);
      history.pushState = origPush;
      history.replaceState = origReplace;
      delete window.__netdigestRecorder;
    }
  };
  return 'on';
})()`;

const RECORDER_DRAIN = `(window.__netdigestRecorder ? window.__netdigestRecorder.drain() : null)`;
const RECORDER_STOP = `(window.__netdigestRecorder ? (window.__netdigestRecorder.stop(), 'off') : 'off')`;

interface RecorderEvent {
  kind: string;
  tag?: string;
  label?: string;
  href?: string;
  at: number;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function describeEvent(ev: RecorderEvent): string {
  if (ev.kind === 'submit') return `submit form "${ev.label || 'form'}"`;
  if (ev.kind === 'navigate') return `navigate ${ev.label ?? ''}`;
  const label = ev.label ? ` "${ev.label}"` : '';
  const href = ev.href ? ` → ${ev.href}` : '';
  return `click ${ev.tag ?? 'element'}${label}${href}`;
}

// Injection fails transiently while the page is mid-navigation - retry via the
// poll loop and only give up after several consecutive failures.
let installFailures = 0;

function installRecorder() {
  inspected?.eval(RECORDER_INSTALL, (_result, err) => {
    if (!bridge.recording) return;
    if (err) {
      installFailures++;
      if (installFailures >= 6) {
        stopPolling();
        bridge.recording = false;
        bridge.error = `Recorder injection failed: ${JSON.stringify(err).slice(0, 200)}`;
        notify();
      }
      return; // next drain tick retries
    }
    installFailures = 0;
  });
}

function drainRecorder() {
  if (!bridge.recording || !inspected) return;
  inspected.eval(RECORDER_DRAIN, (result) => {
    if (result === null && bridge.recording) {
      installRecorder(); // page reloaded without onNavigated firing → re-arm
      return;
    }
    if (!Array.isArray(result)) return;
    for (const ev of result as RecorderEvent[]) pushMarker(describeEvent(ev), ev.at);
  });
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

bridge.setRecording = (on: boolean) => {
  if (on === bridge.recording) return;
  if (on && !inspected) {
    bridge.error = 'Recorder unavailable: no access to the inspected page.';
    notify();
    return;
  }
  bridge.recording = on;
  if (on) {
    installFailures = 0;
    installRecorder();
    pollTimer = setInterval(drainRecorder, 500);
    pushMarker('● recording started');
    // situate the model: which page the flow starts on
    inspected?.eval('location.href', (href) => {
      if (typeof href === 'string' && href) pushMarker(`page ${href.slice(0, 200)}`);
    });
  } else {
    stopPolling();
    inspected?.eval(RECORDER_STOP, () => {});
    pushMarker('recording stopped');
  }
  notify();
};

// ---- Panel registration ----

browser.devtools.panels.create('NetDigest', 'icon/48.png', 'devtools-panel.html', (panel) => {
  // Every time the panel is shown, (re)attach the bridge onto its window.
  (panel as { onShown?: { addListener(cb: (win: Window) => void): void } })?.onShown?.addListener(
    (win) => {
      (win as BridgeWindow).NETDIGEST_BRIDGE = bridge;
      notify();
    },
  );
});
