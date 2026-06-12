// Who triggered the request? Chrome's HAR entries carry "_initiator" (V8 stack,
// including async parent chains). Apps usually route every call through one HTTP
// wrapper, so the first frames are all the same lib — the interesting frame (the
// React hook / app code) sits deeper. We surface both: "at" = fetch call site,
// "via" = first app-level frame, and the code snippet targets the app frame.
import type { InitiatorInfo } from './compact';

export interface StackFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number; // 0-based (V8)
  columnNumber?: number; // 0-based
}

export interface HarStack {
  callFrames?: StackFrame[];
  parent?: HarStack;
  description?: string;
}

export interface HarInitiator {
  type?: string; // script | parser | preload | other | preflight
  url?: string;
  lineNumber?: number;
  stack?: HarStack;
}

function pathOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)/i.exec(url);
  return m ? m[1] : url;
}

function frameLabel(f: StackFrame): string {
  const loc = `${pathOf(f.url ?? '?')}:${(f.lineNumber ?? 0) + 1}:${(f.columnNumber ?? 0) + 1}`;
  return f.functionName ? `${loc} (${f.functionName})` : loc;
}

/** All frames in order, async parent chains included. */
export function flattenFrames(stack: HarStack | undefined, cap = 40): StackFrame[] {
  const out: StackFrame[] = [];
  let current = stack;
  while (current && out.length < cap) {
    for (const f of current.callFrames ?? []) {
      out.push(f);
      if (out.length >= cap) break;
    }
    current = current.parent;
  }
  return out;
}

const HOOK_RE = /^use[A-Z]/;

/** top = physical fetch call site; app = the meaningful application frame. */
export function pickFrames(raw: HarInitiator | undefined): { top?: StackFrame; app?: StackFrame } {
  const frames = flattenFrames(raw?.stack);
  const top = frames[0];
  if (!top) return {};
  // React hooks are gold; otherwise the first frame leaving the HTTP-wrapper file.
  const hook = frames.find((f) => f.functionName && HOOK_RE.test(f.functionName));
  const otherFile = frames.find((f) => f.url && f.url !== top.url);
  const app = hook ?? otherFile;
  return { top, app: app && app !== top ? app : undefined };
}

export function buildInitiator(raw: HarInitiator | undefined): InitiatorInfo | undefined {
  if (!raw) return undefined;
  const { top, app } = pickFrames(raw);
  if (!top) {
    if (raw.url) return { kind: raw.type ?? 'other', at: `${pathOf(raw.url)}:${(raw.lineNumber ?? 0) + 1}` };
    return raw.type && raw.type !== 'other' ? { kind: raw.type } : undefined;
  }
  return {
    kind: raw.type ?? 'script',
    at: frameLabel(top),
    ...(app ? { via: frameLabel(app) } : {}),
  };
}

/**
 * 3-line snippet around the call site (line before, ">"-marked call line, line
 * after). Minified one-line bundles are windowed around the call column.
 */
export function makeSnippet(content: string, line0: number, col0: number): string {
  const lines = content.split('\n');
  if (line0 < 0 || line0 >= lines.length) return '';
  const clip = (s: string, center?: number): string => {
    s = s.replace(/\r$/, '');
    if (s.length <= 200) return s;
    if (center === undefined) return `${s.slice(0, 160)}…`;
    const start = Math.max(0, center - 60);
    return `${start > 0 ? '…' : ''}${s.slice(start, center + 140)}…`;
  };
  const out: string[] = [];
  for (let i = Math.max(0, line0 - 1); i <= Math.min(lines.length - 1, line0 + 1); i++) {
    out.push(`${i === line0 ? '>' : ' '}${i + 1}│ ${clip(lines[i], i === line0 ? col0 : undefined)}`);
  }
  return out.join('\n');
}
