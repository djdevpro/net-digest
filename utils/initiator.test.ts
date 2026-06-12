import { describe, expect, it } from 'vitest';
import { buildInitiator, flattenFrames, makeSnippet, pickFrames, type HarInitiator } from './initiator';

const LIB = 'http://localhost:3000/_next/static/chunks/libs_http_e8bb._.js';
const HOOK = 'http://localhost:3000/_next/static/chunks/app_hooks_useUsers_ts.js';

// real-world shape: the sync frames sit in the HTTP wrapper, the hook lives in
// the async parent chain
const realStack: HarInitiator = {
  type: 'script',
  stack: {
    callFrames: [
      { functionName: 'request', url: LIB, lineNumber: 1525, columnNumber: 32 },
      { functionName: 'request', url: LIB, lineNumber: 1600, columnNumber: 24 },
    ],
    parent: {
      description: 'await',
      callFrames: [
        { functionName: 'getMe', url: LIB, lineNumber: 1700, columnNumber: 10 },
        { functionName: 'useUsersMe', url: HOOK, lineNumber: 11, columnNumber: 8 },
      ],
    },
  },
};

describe('frame picking', () => {
  it('flattens async parent chains', () => {
    expect(flattenFrames(realStack.stack)).toHaveLength(4);
  });

  it('prefers React-hook-named frames as the app frame', () => {
    const { top, app } = pickFrames(realStack);
    expect(top?.functionName).toBe('request');
    expect(app?.functionName).toBe('useUsersMe');
  });

  it('falls back to the first frame from another file', () => {
    const init = buildInitiator({
      type: 'script',
      stack: {
        callFrames: [
          { functionName: 'request', url: LIB, lineNumber: 1, columnNumber: 1 },
          { functionName: 'loadDashboard', url: HOOK, lineNumber: 40, columnNumber: 2 },
        ],
      },
    })!;
    expect(init.via).toContain('loadDashboard');
  });

  it('omits via when nothing is distinctive', () => {
    const init = buildInitiator({
      type: 'script',
      stack: { callFrames: [{ functionName: 'a', url: LIB, lineNumber: 1, columnNumber: 1 }] },
    })!;
    expect(init.via).toBeUndefined();
  });
});

describe('buildInitiator labels', () => {
  it('formats 1-based file:line:col with the function name, path only', () => {
    const init = buildInitiator(realStack)!;
    expect(init.at).toBe('/_next/static/chunks/libs_http_e8bb._.js:1526:33 (request)');
    expect(init.via).toBe('/_next/static/chunks/app_hooks_useUsers_ts.js:12:9 (useUsersMe)');
  });

  it('handles parser initiators and empty ones', () => {
    expect(buildInitiator({ type: 'parser', url: 'https://x.app/index.html', lineNumber: 12 })).toEqual({
      kind: 'parser',
      at: '/index.html:13',
    });
    expect(buildInitiator({ type: 'other' })).toBeUndefined();
    expect(buildInitiator(undefined)).toBeUndefined();
  });
});

describe('makeSnippet', () => {
  it('returns 3 lines with the call line marked', () => {
    const snippet = makeSnippet('function a(){\n  let n = await fetch(l(e, i));\n  if (p(w)) return n;\n}', 1, 17);
    const lines = snippet.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith(' 1│')).toBe(true);
    expect(lines[1]).toContain('>2│   let n = await fetch');
  });

  it('windows minified one-liners around the call column', () => {
    const minified = 'x'.repeat(5000) + 'await fetch("/api/articles")' + 'y'.repeat(5000);
    const snippet = makeSnippet(minified, 0, 5000);
    expect(snippet).toContain('await fetch');
    expect(snippet).toContain('…');
    expect(snippet.length).toBeLessThan(260);
  });

  it('is safe on out-of-range lines', () => {
    expect(makeSnippet('one line', 5, 0)).toBe('');
  });
});
