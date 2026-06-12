import type { CompactEntry } from './compact';

// Object shared between the devtools page (capture side) and the panel (display side).
// The devtools page attaches it onto the panel's window via panel.onShown.
export interface HarBridge {
  entries: CompactEntry[];
  dropped: number;
  error: string | null;
  onChange: (() => void) | null;
  /** hostname of the inspected page (no port), used by the "same domain" filter */
  pageHost: string | null;
  /** true while the interaction recorder is armed on the inspected page */
  recording: boolean;
  /** toggles the interaction recorder (clicks/submits/navigations → timeline steps) */
  setRecording?(on: boolean): void;
  /** removes specific entries (and cleans the dedup index) on the capture side */
  remove?(entries: CompactEntry[]): void;
  /** clears the buffer AND the dedup index on the capture side */
  reset(): void;
}

export const MAX_ENTRIES = 500; // memory guard for long sessions

export type BridgeWindow = Window & { NETDIGEST_BRIDGE?: HarBridge };

/** hostname (no port, no credentials) of a URL, never throws. */
export function hostOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  if (!m) return null;
  const authority = m[1].split('@').pop()!;
  const v6 = /^\[([^\]]+)\]/.exec(authority);
  return (v6 ? v6[1] : authority.split(':')[0]).toLowerCase();
}

// Content that is never "API data": images, fonts, media, HTML/CSS/JS bundles,
// Next.js RSC text payloads, raw binaries. They pollute LLM exports.
const NON_API_MIME_PREFIX_RE = /^(image|font|audio|video)\//i;
const NON_API_MIME = new Set([
  'text/html',
  'text/css',
  'text/plain',
  'text/javascript',
  'application/javascript',
  'application/octet-stream',
  'application/wasm',
  'image/svg+xml',
  'text/x-component', // React Server Components flight data
]);

// Build/runtime tooling traffic that should never even be captured: source maps
// (including NetDigest's own map fetches, which run in the page context), Next.js
// RSC navigation payloads, PWA manifests.
const SOURCEMAP_URL_RE = /\.(?:js|mjs|css)\.map(?:$|\?)/i;
const MANIFEST_URL_RE = /\/manifest\.(?:json|webmanifest)(?:$|\?)/i;

export function isToolingNoise(url: string, mimeType?: string): boolean {
  if (SOURCEMAP_URL_RE.test(url)) return true;
  if (/[?&]_rsc=/.test(url)) return true;
  if (MANIFEST_URL_RE.test(url)) return true;
  if (mimeType?.split(';')[0].trim().toLowerCase() === 'text/x-component') return true;
  return false;
}

/** true when the response looks like API data (JSON/XML/form…), not an asset. */
export function isApiLike(mimeType?: string): boolean {
  if (!mimeType) return true; // 204 / no body → keep
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  return !NON_API_MIME_PREFIX_RE.test(mime) && !NON_API_MIME.has(mime);
}

/**
 * true when the URL belongs to the same site as the inspected page.
 * Tolerates subdomains (api.example.com ↔ app.example.com) by comparing
 * the last two labels; strict equality for IP addresses.
 */
export function isSameSite(url: string, pageHost: string | null): boolean {
  if (!pageHost) return true; // unknown host → no filtering
  const host = hostOf(url);
  if (!host) return false;
  if (host === pageHost) return true;
  if (/^[\d.]+$/.test(pageHost) || pageHost.includes(':')) return false; // IPv4/v6
  const base = pageHost.split('.').slice(-2).join('.');
  return host === base || host.endsWith(`.${base}`);
}
