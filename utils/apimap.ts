// Condensed API map: groups captured calls by normalized endpoint
// (/api/articles/42 → /api/articles/:id) and keeps one tiny example per side.
// This is the "contract view" of the traffic — even cheaper than the capture.
import { DETAIL_LEVELS, recompactValue, type CompactEntry } from './compact';
import { isApiLike } from './bridge';

const SAMPLE_LIMITS = DETAIL_LEVELS.S;

export interface ApiEndpoint {
  method: string;
  endpoint: string;
  calls: number;
  statuses: number[];
  query?: string[];
  request?: unknown;
  response?: unknown;
}

function normalizeSegment(seg: string): string {
  if (/^\d+$/.test(seg)) return ':id';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
  if (/^[0-9a-f]{16,}$/i.test(seg)) return ':hash';
  return seg;
}

interface Group {
  method: string;
  endpoint: string;
  calls: number;
  statuses: Set<number>;
  query: Set<string>;
  request: unknown;
  response: unknown;
  responseIsError: boolean;
}

export function buildApiMap(entries: CompactEntry[]): ApiEndpoint[] {
  const groups = new Map<string, Group>();

  for (const e of entries) {
    if (e.type === 'marker') continue;
    // assets never belong in an API map — but errors always do (HTML error pages included)
    if (!isApiLike(e.mimeType) && e.status < 400 && e.status !== 0) continue;
    const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)\??([^#]*)/i.exec(e.url);
    if (!m) continue;
    const path = (m[2] || '/').split('/').map(normalizeSegment).join('/');
    const endpoint = m[1] + path;
    const key = `${e.method} ${endpoint}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        method: e.method,
        endpoint,
        calls: 0,
        statuses: new Set(),
        query: new Set(),
        request: undefined,
        response: undefined,
        responseIsError: false,
      };
      groups.set(key, g);
    }

    g.calls += e.count ?? 1;
    g.statuses.add(e.status);
    if (m[3]) {
      for (const pair of m[3].split('&')) {
        const k = pair.split('=')[0];
        if (k) g.query.add(decodeURIComponent(k));
      }
    }
    if (g.request === undefined && e.requestBody != null) {
      g.request = recompactValue(e.requestBody, SAMPLE_LIMITS);
    }
    // prefer a success sample; fall back to an error body until one shows up
    const isError = e.status >= 400 || e.status === 0;
    if (e.responseBody != null && (g.response === undefined || (g.responseIsError && !isError))) {
      g.response = recompactValue(e.responseBody, SAMPLE_LIMITS);
      g.responseIsError = isError;
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method))
    .map((g) => ({
      method: g.method,
      endpoint: g.endpoint,
      calls: g.calls,
      statuses: [...g.statuses].sort((a, b) => a - b),
      ...(g.query.size ? { query: [...g.query] } : {}),
      ...(g.request !== undefined ? { request: g.request } : {}),
      ...(g.response !== undefined ? { response: g.response } : {}),
    }));
}
