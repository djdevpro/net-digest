import { describe, expect, it } from 'vitest';
import {
  CAPTURE_LIMITS,
  DETAIL_LEVELS,
  compactBody,
  compactValue,
  recompactEntry,
  recompactValue,
  type CompactEntry,
} from './compact';

const capture = (v: unknown) => compactValue(v, CAPTURE_LIMITS);
const { S, M, L } = DETAIL_LEVELS;

const baseEntry: CompactEntry = {
  startedDateTime: '2026-06-12T00:00:00.000Z',
  time: 1,
  type: 'fetch',
  method: 'GET',
  url: 'https://api.example.dev/api/x',
  status: 200,
  requestBody: null,
  responseBody: null,
};

describe('capture compaction', () => {
  it('truncates long strings and keeps the true total', () => {
    const out = capture({ text: 'x'.repeat(2000) }) as Record<string, string>;
    expect(out.text.startsWith('x'.repeat(1024))).toBe(true);
    expect(out.text).toContain('…[truncated, 2000 chars total]');
  });

  it('cuts arrays at 8 items with a total marker', () => {
    const out = capture(Array.from({ length: 50 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(9);
    expect(out[8]).toBe('…[+42 items, 50 total]');
  });

  it('shrinks base64 content hard', () => {
    const body = compactBody('UklGRmIcAABXRUJQVlA4WAoA'.repeat(500), 'base64') as string;
    expect(body).toContain('…[base64 binary,');
    expect(body.length).toBeLessThan(150);
  });

  it('parses JSON bodies and falls back to truncated text', () => {
    expect(compactBody('{"a":1}')).toEqual({ a: 1 });
    expect(compactBody('a=1&b=2')).toBe('a=1&b=2');
    expect(compactBody(null)).toBeNull();
  });

  it('keeps every object key up to the 500-key guard', () => {
    const all = capture(Object.fromEntries(Array.from({ length: 456 }, (_, i) => [`k${i}`, i])));
    expect(Object.keys(all as object)).toHaveLength(456);
    const guarded = capture(Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i]))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(guarded)).toHaveLength(501);
    expect(guarded['…']).toBe('[+100 keys, 600 total]');
  });
});

describe('secret redaction (always on)', () => {
  it('redacts sensitive keys but not lookalikes', () => {
    const out = capture({
      password: 'hunter2',
      api_key: 'abc',
      author: 'Victor Hugo',
      session_duration: 3600,
      chat_token_quota_monthly: 500000,
      access_token: 'abc',
      tokens: ['a', 'b'],
      session_id: 'x',
      vapid_private_key: 'k',
      nested: { Authorization: 'Bearer xyz' },
    }) as Record<string, unknown>;
    expect(out.password).toBe('***');
    expect(out.api_key).toBe('***');
    expect(out.access_token).toBe('***');
    expect(out.tokens).toBe('***');
    expect(out.session_id).toBe('***');
    expect(out.vapid_private_key).toBe('***');
    expect((out.nested as Record<string, unknown>).Authorization).toBe('***');
    expect(out.author).toBe('Victor Hugo');
    expect(out.session_duration).toBe(3600);
    expect(out.chat_token_quota_monthly).toBe(500000);
  });

  it('redacts JWT-looking values under innocent keys and form-encoded secrets', () => {
    const jwt = capture({ data: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' }) as Record<string, unknown>;
    expect(jwt.data).toBe('***');
    expect(compactBody('user=jo&password=secret123&x=1')).toBe('user=jo&password=***&x=1');
  });
});

describe('marker-aware re-truncation', () => {
  it('keeps original totals across successive passes', () => {
    const captured = compactBody(
      JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'y'.repeat(2000) })) }),
    ) as { items: unknown[] };
    expect(captured.items).toHaveLength(9);

    const m = recompactValue(captured, M) as { items: unknown[] };
    expect(m.items).toHaveLength(4);
    expect(m.items[3]).toBe('…[+47 items, 50 total]');
    expect((m.items[0] as Record<string, string>).text).toContain('2000 chars total');

    const s = recompactValue(m, S) as { items: unknown[] };
    expect(s.items[1]).toBe('…[+49 items, 50 total]');
  });

  it('replaces content beyond the depth limit with descriptive stubs', () => {
    const deep = capture({ data: { items: [{ contact: { societe: { champs: { a: 1, b: 2 }, nom: 'X' } } }] } });
    const m = recompactValue(deep, M) as any;
    expect(m.data.items[0].contact.societe.champs).toBe('…[object, 2 keys]');
    expect(m.data.items[0].contact.societe.nom).toBe('X');
    const s = recompactValue(deep, S) as any;
    expect(s.data.items[0]).toBe('…[object, 1 keys]');
  });
});

describe('sibling dedup and item diff', () => {
  it('collapses identical sibling objects to a reference', () => {
    const batch = capture({
      data: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`44${23 + i}`, { total: 0, todo: 0, inProgress: 0, completed: 0, links: [] }]),
      ),
    });
    const out = recompactValue(batch, M) as { data: Record<string, unknown> };
    const values = Object.values(out.data);
    expect(typeof values[0]).toBe('object');
    expect(values.slice(1).every((v) => v === '…[same as "4423"]')).toBe(true);
  });

  it('never collapses scalars', () => {
    const out = recompactValue(capture({ a: 0, b: 0, c: 0 }), M) as Record<string, number>;
    expect([out.a, out.b, out.c]).toEqual([0, 0, 0]);
  });

  it('diffs array items against item 0', () => {
    const item = (id: number, label: string) => ({
      id,
      type: 71,
      label,
      order: id,
      isAdmin: false,
      createdBy: 'LP',
      updatedBy: 'SV',
      createdAt: null,
      updatedAt: null,
    });
    const out = recompactValue(capture({ items: [item(1, 'CP'), item(2, 'AM'), item(3, 'RTT')] }), L) as {
      items: Record<string, unknown>[];
    };
    expect(Object.keys(out.items[0])).toHaveLength(9);
    expect(out.items[1].id).toBe(2);
    expect(out.items[1]).not.toHaveProperty('type');
    expect(out.items[1]).not.toHaveProperty('createdBy');
    expect(out.items[1]['…']).toBe('[6 keys same as item 0]');
  });

  it('keeps heterogeneous items whole', () => {
    const out = recompactValue(capture([{ a: 1, b: 2, c: 3 }, { x: 9, y: 8, z: 7 }]), M) as Record<string, unknown>[];
    expect(out[1]).toHaveProperty('x');
    expect(out[1]).not.toHaveProperty('…');
  });
});

describe('export entries', () => {
  it('keeps headers only when asked', () => {
    const entry = { ...baseEntry, requestHeaders: { etag: 'x' } };
    expect(recompactEntry(entry, M, false)).not.toHaveProperty('requestHeaders');
    expect((recompactEntry(entry, M, true) as Record<string, unknown>).requestHeaders).toEqual({ etag: 'x' });
  });

  it('exports markers as minimal steps', () => {
    const out = recompactEntry(
      { ...baseEntry, type: 'marker', url: 'clicked Save' },
      M,
      false,
    ) as Record<string, unknown>;
    expect(out).toEqual({ type: 'marker', label: 'clicked Save', at: baseEntry.startedDateTime });
  });

  it('flattens the initiator to a single line, preferring the app frame', () => {
    const withVia = recompactEntry(
      { ...baseEntry, initiator: { kind: 'script', at: '/chunk.js:1:1 (request)', via: 'src/hooks/useX.ts:12:9 (useX)' } },
      M,
      false,
    ) as Record<string, unknown>;
    expect(withVia.initiator).toBe('src/hooks/useX.ts:12:9 (useX)');
    const atOnly = recompactEntry(
      { ...baseEntry, initiator: { kind: 'script', at: '/chunk.js:1:1 (request)' } },
      M,
      false,
    ) as Record<string, unknown>;
    expect(atOnly.initiator).toBe('/chunk.js:1:1 (request)');
    expect(recompactEntry(baseEntry, M, false)).not.toHaveProperty('initiator');
  });
});
