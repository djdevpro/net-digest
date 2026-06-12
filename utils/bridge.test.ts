import { describe, expect, it } from 'vitest';
import { hostOf, isApiLike, isSameSite, isToolingNoise } from './bridge';

describe('hostOf', () => {
  it('extracts hostnames without port or credentials', () => {
    expect(hostOf('https://tpk.api.example.app/api/x?y=1')).toBe('tpk.api.example.app');
    expect(hostOf('http://127.0.0.1:8001/api/articles')).toBe('127.0.0.1');
    expect(hostOf('not a url')).toBeNull();
  });
});

describe('isSameSite', () => {
  it('tolerates subdomains of the inspected page', () => {
    expect(isSameSite('https://tpk.api.example.app/api/x', 'tpk.example.app')).toBe(true);
    expect(isSameSite('https://example.app/x', 'tpk.example.app')).toBe(true);
  });

  it('excludes third parties', () => {
    expect(isSameSite('https://cdn.cookielaw.org/consent/x.json', 'tpk.example.app')).toBe(false);
    expect(isSameSite('https://geolocation.onetrust.com/x', 'tpk.example.app')).toBe(false);
  });

  it('uses strict equality for IPs and localhost', () => {
    expect(isSameSite('http://127.0.0.1:8001/api/x', '127.0.0.1')).toBe(true);
    expect(isSameSite('https://cdn.cookielaw.org/x', '127.0.0.1')).toBe(false);
    expect(isSameSite('http://localhost:3000/x', 'localhost')).toBe(true);
  });

  it('lets everything through when the host is unknown', () => {
    expect(isSameSite('https://anything.dev/x', null)).toBe(true);
  });
});

describe('isApiLike', () => {
  it('keeps API content types and bodyless responses', () => {
    expect(isApiLike('application/json')).toBe(true);
    expect(isApiLike('application/json; charset=utf-8')).toBe(true);
    expect(isApiLike(undefined)).toBe(true);
  });

  it('rejects assets even when loaded via fetch', () => {
    for (const mime of ['image/webp', 'font/woff2', 'text/html', 'text/plain', 'text/x-component']) {
      expect(isApiLike(mime)).toBe(false);
    }
  });
});

describe('isToolingNoise', () => {
  it('drops source maps, RSC payloads and manifests at capture time', () => {
    expect(isToolingNoise('http://localhost:3000/_next/static/chunks/_c3d8c4a5._.js.map')).toBe(true);
    expect(isToolingNoise('http://localhost:3000/?_rsc=15c8q')).toBe(true);
    expect(isToolingNoise('http://localhost:3000/manifest.json')).toBe(true);
    expect(isToolingNoise('http://x/y', 'text/x-component')).toBe(true);
  });

  it('keeps real API calls, including business "map" endpoints', () => {
    expect(isToolingNoise('http://127.0.0.1:8001/api/articles?perPage=200', 'application/json')).toBe(false);
    expect(isToolingNoise('http://127.0.0.1:8001/api/maps/geo.json', 'application/json')).toBe(false);
  });
});
