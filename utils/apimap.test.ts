import { describe, expect, it } from 'vitest';
import { buildApiMap } from './apimap';
import type { CompactEntry } from './compact';

const entry = (over: Partial<CompactEntry>): CompactEntry => ({
  startedDateTime: '2026-06-12T00:00:00.000Z',
  time: 1,
  type: 'fetch',
  method: 'GET',
  url: 'https://api.x.app/api/x',
  status: 200,
  mimeType: 'application/json',
  requestBody: null,
  responseBody: null,
  ...over,
});

describe('buildApiMap', () => {
  it('normalizes ids, merges calls and collects statuses + query keys', () => {
    const map = buildApiMap([
      entry({ url: 'https://api.x.app/api/articles/42?page=2', count: 3, responseBody: { id: 42 } }),
      entry({ url: 'https://api.x.app/api/articles/17', status: 404, responseBody: { error: 'nf' } }),
      entry({ method: 'POST', url: 'https://api.x.app/api/login', status: 401, requestBody: { email: 'a' }, responseBody: { m: 'no' } }),
    ]);
    expect(map).toHaveLength(2);
    const articles = map.find((e) => e.endpoint.includes(':id'))!;
    expect(articles.calls).toBe(4);
    expect(articles.statuses).toEqual([200, 404]);
    expect(articles.query).toContain('page');
  });

  it('prefers a success sample for the response example', () => {
    const map = buildApiMap([
      entry({ url: 'https://api.x.app/api/items/3', status: 500, responseBody: { error: 'boom' } }),
      entry({ url: 'https://api.x.app/api/items/4', status: 200, responseBody: { id: 4 } }),
    ]);
    expect((map[0].response as Record<string, unknown>).id).toBe(4);
  });

  it('skips markers and non-API assets, but keeps API errors', () => {
    const map = buildApiMap([
      entry({ type: 'marker', url: 'clicked Save' }),
      entry({ url: 'https://x.app/ciel.webp', mimeType: 'image/webp', responseBody: 'UklGR…' }),
      entry({ url: 'https://x.app/api/fail', status: 500, mimeType: 'text/html', responseBody: '<html>err' }),
      entry({ url: 'https://x.app/api/items/3', responseBody: { id: 3 } }),
    ]);
    const endpoints = map.map((m) => m.endpoint);
    expect(endpoints.some((e) => e.includes('ciel.webp'))).toBe(false);
    expect(endpoints.some((e) => e.includes('/api/fail'))).toBe(true);
    expect(endpoints.some((e) => e.includes('/api/items/:id'))).toBe(true);
  });

  it('normalizes uuids and long hashes', () => {
    const map = buildApiMap([
      entry({ url: 'https://x.app/api/jobs/0b66ecb9-4a5f-4c89-9c57-f1ca6f448b04' }),
      entry({ url: 'https://x.app/api/blobs/0123456789abcdef0123' }),
    ]);
    expect(map.map((m) => m.endpoint).sort()).toEqual([
      'https://x.app/api/blobs/:hash',
      'https://x.app/api/jobs/:uuid',
    ]);
  });
});
