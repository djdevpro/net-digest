// Recursive compaction of network bodies: the full object shape is preserved,
// values are truncated and secrets are redacted, producing a lightweight JSON
// ready to encode as TOON and paste into an LLM.

export interface CompactLimits {
  string: number; // characters kept per string value
  array: number; // items kept per array
  base64: number; // characters kept for base64 content
  keys: number; // safety guard only — object keys are meant to ALL be kept (shape is sacred)
  depth: number; // nesting level after which objects/arrays become descriptive stubs
}

/** Capture keeps a generous version; exports re-truncate down to S/M/L. */
export const CAPTURE_LIMITS: CompactLimits = { string: 1024, array: 8, base64: 96, keys: 500, depth: 10 };

export const DETAIL_LEVELS: Record<'S' | 'M' | 'L', CompactLimits> = {
  S: { string: 64, array: 1, base64: 24, keys: 500, depth: 3 },
  M: { string: 255, array: 3, base64: 48, keys: 500, depth: 6 },
  L: CAPTURE_LIMITS,
};

export type DetailLevel = keyof typeof DETAIL_LEVELS;

export const MAX_URL = 1024;
export const REDACTED = '***';

const DATA_URI_RE = /^data:[\w.+-]+\/[\w.+-]+;base64,/i;
const BASE64_BODY_RE = /^[A-Za-z0-9+/\r\n=_-]+$/;
const BASE64_MIN_LENGTH = 120;

// Keys whose values are never worth leaking to an LLM. Redaction is always on.
// "token"/"session" need boundaries: session_duration or token_quota are NOT secrets.
const SENSITIVE_KEY_RE =
  /(password|passwd|passphrase|secret|credential|authorization|api[-_]?key|apikey|private[-_]?key|jwt|cookie|csrf|(^|[-_])auth$|(^|[-_])tokens?$|session[-_]?(id|key|token)$|(^|[-_])session$)/i;
// Values that look like credentials even under an innocent key.
const JWT_RE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;
const BEARER_RE = /^bearer\s+\S+/i;
const FORM_SECRET_RE = /((?:password|passwd|secret|token|api[-_]?key|authorization)=)[^&\s]+/gi;

// Truncation markers — recompaction parses them to keep true totals accurate.
const STR_MARKER_RE = /…\[(truncated|base64 truncated|base64 binary), (\d+) chars total\]$/;
const ARR_MARKER_RE = /^…\[\+\d+ items, (\d+) total\]$/;
const OBJ_MARKER_KEY = '…';
const OBJ_MARKER_RE = /^\[\+\d+ keys, (\d+) total\]$/;

function objMarker(hidden: number, total: number): string {
  return `[+${hidden} keys, ${total} total]`;
}

/** Descriptive stub for content cut at the depth limit — tells the model what was there. */
function stubFor(value: unknown): string {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    const m = typeof last === 'string' ? ARR_MARKER_RE.exec(last) : null;
    return `…[array, ${m ? Number(m[1]) : value.length} items]`;
  }
  if (value && typeof value === 'object') {
    const marker = (value as Record<string, unknown>)[OBJ_MARKER_KEY];
    const m = typeof marker === 'string' ? OBJ_MARKER_RE.exec(marker) : null;
    return `…[object, ${m ? Number(m[1]) : Object.keys(value).length} keys]`;
  }
  return '…[depth limit]';
}

export function isLikelyBase64(value: string): boolean {
  if (DATA_URI_RE.test(value)) return value.length > 96;
  if (value.length < BASE64_MIN_LENGTH) return false;
  // base64 charset (incl. URL-safe variant), no spaces/punctuation, mixed letters+digits
  const sample = value.slice(0, 512);
  return BASE64_BODY_RE.test(sample) && /[a-z]/i.test(sample) && /[0-9]/.test(sample);
}

function strMarker(kind: string, total: number): string {
  return `…[${kind}, ${total} chars total]`;
}

function arrMarker(hidden: number, total: number): string {
  return `…[+${hidden} items, ${total} total]`;
}

export function compactString(value: string, limits: CompactLimits): string {
  if (JWT_RE.test(value) || BEARER_RE.test(value)) return REDACTED;
  if (isLikelyBase64(value)) {
    return value.length > limits.base64
      ? `${value.slice(0, limits.base64)}${strMarker('base64 truncated', value.length)}`
      : value;
  }
  if (value.length > limits.string) {
    return `${value.slice(0, limits.string)}${strMarker('truncated', value.length)}`;
  }
  return value;
}

export function capUrl(url: string): string {
  return url.length > MAX_URL ? `${url.slice(0, MAX_URL)}…[URL truncated, ${url.length} chars]` : url;
}

/** Recursively walks any JSON value, truncating every leaf and redacting secrets. */
export function compactValue(value: unknown, limits: CompactLimits, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'string') return compactString(value as string, limits);
  if (depth >= limits.depth) return stubFor(value);
  if (Array.isArray(value)) {
    const kept: unknown[] = value.slice(0, limits.array).map((v) => compactValue(v, limits, depth + 1));
    if (value.length > limits.array) {
      kept.push(arrMarker(value.length - limits.array, value.length));
    }
    return kept;
  }
  if (type === 'object') {
    const entries = Object.entries(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries.slice(0, limits.keys)) {
      if (SENSITIVE_KEY_RE.test(key) && (val === null || typeof val !== 'object')) {
        out[key] = REDACTED;
      } else if (SENSITIVE_KEY_RE.test(key) && Array.isArray(val)) {
        out[key] = REDACTED;
      } else {
        out[key] = compactValue(val, limits, depth + 1);
      }
    }
    if (entries.length > limits.keys) {
      out[OBJ_MARKER_KEY] = objMarker(entries.length - limits.keys, entries.length);
    }
    return out;
  }
  return compactString(String(value), limits);
}

/** Compacts a raw body (request or response): JSON → recursive walk, otherwise truncated text. */
export function compactBody(text: string | null | undefined, encoding?: string, limits: CompactLimits = CAPTURE_LIMITS): unknown {
  if (!text) return null;
  if (encoding === 'base64') {
    return text.length > limits.base64
      ? `${text.slice(0, limits.base64)}${strMarker('base64 binary', text.length)}`
      : text;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return compactValue(JSON.parse(trimmed), limits);
    } catch {
      // invalid JSON → treated as plain text
    }
  }
  // form-encoded / plain text: redact obvious key=value secrets
  return compactString(text.replace(FORM_SECRET_RE, `$1${REDACTED}`), limits);
}

// ---- Export-time re-truncation (marker-aware) ----
// Captured data already carries truncation markers; re-truncating must keep the
// ORIGINAL totals, not the captured lengths.

function recompactString(value: string, limits: CompactLimits): string {
  const m = STR_MARKER_RE.exec(value);
  if (!m) return compactString(value, limits);
  const kind = m[1];
  const total = Number(m[2]);
  const prefix = value.slice(0, m.index);
  const limit = kind === 'truncated' ? limits.string : limits.base64;
  if (prefix.length <= limit) return value;
  return `${prefix.slice(0, limit)}${strMarker(kind, total)}`;
}

// Sibling values that are deeply identical after compaction get collapsed to a
// reference ("…[same as …]") — APIs love returning N copies of the same structure.
const DEDUPE_MIN_SIZE = 40; // never collapse scalars or tiny objects

/**
 * Array items after the first only show fields that DIFFER from item 0: the first
 * item establishes the full shape and the common values; repeating them on every
 * item would only burn tokens. All keys remain reconstructible via the marker.
 */
function diffAgainstFirst(first: Record<string, unknown>, item: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {};
  let same = 0;
  for (const [key, val] of Object.entries(item)) {
    if (key in first && JSON.stringify(first[key]) === JSON.stringify(val)) {
      same++;
      continue;
    }
    out[key] = val;
  }
  if (same < 3) return item; // not enough redundancy to be worth a marker line
  const missing = Object.keys(first).filter((k) => !(k in item)).length;
  const note = `[${same} keys same as item 0${missing ? `, ${missing} absent` : ''}]`;
  out[OBJ_MARKER_KEY] = typeof out[OBJ_MARKER_KEY] === 'string' ? `${out[OBJ_MARKER_KEY]} ${note}` : note;
  return out;
}

/** Re-truncates an already-compacted value to tighter limits, preserving true totals. */
export function recompactValue(value: unknown, limits: CompactLimits, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'string') return recompactString(value as string, limits);
  if (depth >= limits.depth) return stubFor(value);
  if (Array.isArray(value)) {
    let items = value;
    let total = value.length;
    const last = value[value.length - 1];
    const m = typeof last === 'string' ? ARR_MARKER_RE.exec(last) : null;
    if (m) {
      items = value.slice(0, -1);
      total = Number(m[1]);
    }
    const kept: unknown[] = [];
    const seen = new Map<string, number>();
    let firstObject: Record<string, unknown> | null = null;
    for (const item of items.slice(0, limits.array)) {
      const rv = recompactValue(item, limits, depth + 1);
      if (rv && typeof rv === 'object') {
        const sig = JSON.stringify(rv);
        if (sig.length > DEDUPE_MIN_SIZE) {
          const dup = seen.get(sig);
          if (dup !== undefined) {
            kept.push(`…[same as item ${dup}]`);
            continue;
          }
          seen.set(sig, kept.length);
        }
        if (!Array.isArray(rv)) {
          if (firstObject) {
            kept.push(diffAgainstFirst(firstObject, rv as Record<string, unknown>));
            continue;
          }
          firstObject = rv as Record<string, unknown>;
        }
      }
      kept.push(rv);
    }
    if (kept.length < total) kept.push(arrMarker(total - kept.length, total));
    return kept;
  }
  if (type === 'object') {
    let entries = Object.entries(value as object);
    let total = entries.length;
    const marker = (value as Record<string, unknown>)[OBJ_MARKER_KEY];
    const m = typeof marker === 'string' ? OBJ_MARKER_RE.exec(marker) : null;
    if (m) {
      entries = entries.filter(([key]) => key !== OBJ_MARKER_KEY);
      total = Number(m[1]);
    }
    const out: Record<string, unknown> = {};
    const seen = new Map<string, string>();
    for (const [key, val] of entries.slice(0, limits.keys)) {
      const rv = recompactValue(val, limits, depth + 1);
      if (rv && typeof rv === 'object') {
        const sig = JSON.stringify(rv);
        if (sig.length > DEDUPE_MIN_SIZE) {
          const first = seen.get(sig);
          if (first !== undefined) {
            out[key] = `…[same as "${first}"]`;
            continue;
          }
          seen.set(sig, key);
        }
      }
      out[key] = rv;
    }
    const kept = Math.min(entries.length, limits.keys);
    if (kept < total) out[OBJ_MARKER_KEY] = objMarker(total - kept, total);
    return out;
  }
  return recompactString(String(value), limits);
}

/** Code location that triggered the request (from Chrome's HAR _initiator). */
export interface InitiatorInfo {
  kind: string; // script | parser | preload | other
  at?: string; // fetch call site: "/chunks/lib.js:1526:33 (request)"
  via?: string; // app-level frame: "/chunks/useUsers.js:12:9 (useUsers)"
  code?: string; // 3-line snippet around the app frame (">"-marked line)
}

export interface CompactEntry {
  /** number of identical calls (method+URL+status) merged together; absent when 1 */
  count?: number;
  startedDateTime: string;
  time: number;
  /** resource type (xhr, fetch, document…) or "marker" for user-inserted timeline marks */
  type: string;
  method: string;
  url: string;
  status: number;
  mimeType?: string;
  responseSize?: number;
  /** code location + snippet that triggered the call */
  initiator?: InitiatorInfo;
  /** whitelisted, never-sensitive headers (only when present) */
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody: unknown;
  responseBody: unknown;
}

/** Entry as exported: bodies re-truncated to the chosen detail, headers opt-in. */
export function recompactEntry(entry: CompactEntry, limits: CompactLimits, withHeaders: boolean): unknown {
  if (entry.type === 'marker') {
    return { type: 'marker', label: entry.url, at: entry.startedDateTime };
  }
  const { requestHeaders, responseHeaders, requestBody, responseBody, initiator, ...rest } = entry;
  // Exports keep ONE initiator line: the app/hook frame (fallback: the call site).
  const initiatorLabel = initiator?.via ?? initiator?.at;
  return {
    ...rest,
    ...(initiatorLabel ? { initiator: initiatorLabel } : {}),
    ...(withHeaders && requestHeaders ? { requestHeaders } : {}),
    ...(withHeaders && responseHeaders ? { responseHeaders } : {}),
    requestBody: recompactValue(requestBody, limits),
    responseBody: recompactValue(responseBody, limits),
  };
}
