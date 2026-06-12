// Token benchmark: a realistic 52-request session measured three ways —
// full HAR export, raw JSON bodies, NetDigest TOON (level M).
// Run with: pnpm bench   (bundled first because utils/ are TypeScript)
import { encode } from '@toon-format/toon';
import { compactBody, recompactEntry, CAPTURE_LIMITS, DETAIL_LEVELS } from '../utils/compact';

const tokens = (s) => Math.round(s.length / 4); // ~4 chars/token heuristic

// ---- realistic raw API bodies ----

const lorem =
  'Operational excellence starts with visibility. This intervention covers the full maintenance cycle, including diagnostics, parts replacement and final on-site validation by the technician. '.repeat(3);

const user = (i) => ({
  id: i,
  code: `U${String(i).padStart(3, '0')}`,
  firstName: ['Ada', 'Grace', 'Alan', 'Barbara', 'Linus', 'Margaret'][i % 6],
  lastName: ['Lovelace', 'Hopper', 'Kay', 'Liskov', 'Torvalds', 'Hamilton'][(i * 7) % 6],
  email: `user${i}@example.dev`,
  emailPro: `user${i}@corp.example.dev`,
  phone: `+33 6 ${10 + (i % 80)} ${20 + (i % 70)} ${30 + (i % 60)} ${40 + (i % 50)}`,
  role: i % 9 === 0 ? 'admin' : 'technician',
  active: i % 13 !== 0,
  avatarUrl: `/storage/users/${i}/photo.png`,
  address1: `${i} rue des Artisans`,
  address2: '',
  zip: String(10000 + i * 37),
  city: ['Marseille', 'Lyon', 'Digne-les-Bains', 'Nice'][i % 4],
  country: 'FRA',
  company: { id: 1 + (i % 3), name: ['TECHNI-CORP', 'SYNER-DEMO', 'FLEETWORKS'][i % 3], siret: String(50000000000000 + i) },
  customFields: { label: null, number: 0, combo: null, bool: false, date: null },
  signature: null,
  createdAt: '2024-06-10T09:22:07.000Z',
  updatedAt: '2026-05-27T14:28:23.000Z',
  createdBy: 'SYS',
  updatedBy: 'SYS',
});

const intervention = (i) => ({
  id: 4400 + i,
  ref: `INT-${4400 + i}`,
  title: `115.00${i} - SITE ${['NORD', 'SUD', 'EST', 'OUEST'][i % 4]}`,
  status: ['pending', 'inProgress', 'completed'][i % 3],
  startDate: '2026-06-09',
  endDate: '2026-06-12',
  startTime: '08:00:00',
  endTime: '18:00:00',
  onSite: true,
  notes: lorem,
  team: ['0VM', '0FO', '0RC'].map((code, k) => ({ code, name: `Tech ${k}`, isManager: k === 0, photoUrl: `/u/${code}.webp` })),
  contact: {
    id: 594 + i,
    fullName: 'Philippe DURAND',
    company: 'VALDEMO ENERGIES',
    role: 'Project manager',
    email: 'p.durand@valdemo.example',
    phone: '+33 4 92 28 32 20',
    address: { line1: '609 route des Pins', zip: '06250', city: 'MOUGINS', country: 'FRA' },
  },
  project: {
    id: 1083,
    name: `115.00${i} - MAINTENANCE`,
    progressPct: 27.5,
    budget: { allocated: 0, spent: 0, currency: 'EUR' },
    dates: { start: '2026-06-08', end: '2026-08-31' },
  },
  machine: {
    id: 39,
    code: 'VAN [04]',
    label: 'UTILITY VAN 109 LONG',
    plate: 'AA-123-BB',
    brand: 'DEMO MOTORS',
    km: 181919,
    state: 'Good',
    gps: { lat: 44.0787, lng: 6.02041 },
  },
  customFields: [],
  createdAt: '2026-06-05T14:09:42.000Z',
  updatedAt: '2026-06-11T11:07:22.000Z',
});

const settings = Object.fromEntries(
  Array.from({ length: 456 }, (_, i) => [
    `setting_${['widget', 'module', 'mail', 'fleet', 'hr', 'chat'][i % 6]}_${i}`,
    i % 3 === 0 ? true : i % 3 === 1 ? `value ${i} — configurable label` : i,
  ]),
);

const RAW = [];
// the heavyweights
RAW.push({ method: 'GET', url: '/api/users/list?perPage=1000', status: 200, body: { success: true, data: { items: Array.from({ length: 150 }, (_, i) => user(i)), pagination: { total: 150, perPage: 1000, page: 1 } } } });
RAW.push({ method: 'GET', url: '/api/interventions?page=1', status: 200, body: { success: true, data: { items: Array.from({ length: 10 }, (_, i) => intervention(i)), pagination: { total: 3732, perPage: 10, page: 1, lastPage: 374 } } } });
RAW.push({ method: 'GET', url: '/api/settings', status: 200, body: { success: true, data: settings, count: 456 } });
RAW.push({ method: 'GET', url: '/api/articles?perPage=50', status: 200, body: { success: true, data: { items: Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Article ${i}`, content: lorem, author: user(i % 6) })) } } });
// auth + misc
RAW.push({ method: 'POST', url: '/api/login', status: 200, body: { success: true, data: { user: user(7), token: 'eyJhbGciOiJIUzI1NiJ9.' + 'x'.repeat(180) } }, reqBody: { email: 'jo@example.dev', password: 'hunter2' } });
RAW.push({ method: 'GET', url: '/api/permissions', status: 200, body: { success: true, data: { permissions: Array.from({ length: 130 }, (_, i) => `perm_${i}_manage_resource`), roles: Array.from({ length: 5 }, (_, i) => ({ id: i, name: `role${i}`, displayName: `Role ${i}` })) } } });
// 12 identical polls + assorted small calls
for (let i = 0; i < 12; i++) RAW.push({ method: 'GET', url: '/api/notifications/poll', status: 200, body: { success: true, data: { unread: 2, items: [{ id: 901, kind: 'mention', read: false }] } } });
for (let i = 0; i < 8; i++) RAW.push({ method: 'GET', url: `/api/param-libs?type=${30 + i}`, status: 200, body: { success: true, data: { items: Array.from({ length: 17 }, (_, k) => ({ id: k, type: 30 + i, label: `0${k} - Param label ${k}`, order: k, isAdministrative: false, createdAt: '2020-09-09T11:03:44.709Z', createdBy: 'LP', updatedAt: '2022-02-10T17:05:13.717Z', updatedBy: 'SV' })), pagination: { total: 17 } } } });
for (let i = 0; i < 6; i++) RAW.push({ method: 'GET', url: `/api/dashboard/key-stats?module=${i}`, status: 200, body: { success: true, data: { interventions: { total: 3732, inProgress: 42, pending: 43, completed: 3534 }, anomalies: { total: 12, unresolved: 4 }, alerts: { total: 55, active: 55 }, vehicles: { total: 32 } } } });

const ORIGIN = 'https://api.example.dev';
const harHeaders = [
  { name: 'accept', value: 'application/json, text/plain, */*' },
  { name: 'accept-encoding', value: 'gzip, deflate, br, zstd' },
  { name: 'accept-language', value: 'fr-FR,fr;q=0.9,en-US;q=0.8' },
  { name: 'referer', value: 'https://app.example.dev/' },
  { name: 'user-agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' },
];

// ---- 1) full HAR export (conservative: fewer headers than a real one) ----
const har = {
  log: {
    version: '1.2',
    creator: { name: 'WebInspector', version: '537.36' },
    entries: RAW.map((r, i) => ({
      startedDateTime: new Date(1765500000000 + i * 400).toISOString(),
      time: 120 + (i % 200),
      request: { method: r.method, url: ORIGIN + r.url, httpVersion: 'http/2.0', headers: harHeaders, queryString: [], cookies: [], headersSize: -1, bodySize: r.reqBody ? JSON.stringify(r.reqBody).length : 0, ...(r.reqBody ? { postData: { mimeType: 'application/json', text: JSON.stringify(r.reqBody) } } : {}) },
      response: { status: r.status, statusText: 'OK', httpVersion: 'http/2.0', headers: [...harHeaders, { name: 'content-type', value: 'application/json' }], cookies: [], content: { size: JSON.stringify(r.body).length, mimeType: 'application/json', text: JSON.stringify(r.body) }, redirectURL: '', headersSize: -1, bodySize: -1 },
      cache: {},
      timings: { blocked: 1, dns: -1, ssl: -1, connect: -1, send: 0, wait: 100, receive: 4 },
    })),
  },
};
const harStr = JSON.stringify(har);

// ---- 2) raw JSON bodies only ----
const rawBodiesStr = RAW.map((r) => JSON.stringify(r.body)).join('\n');

// ---- 3) NetDigest pipeline: capture-compact → dedup → recompact M → TOON ----
const index = new Map();
const entries = [];
RAW.forEach((r, i) => {
  const key = `${r.method} ${r.status} ${ORIGIN + r.url}`;
  if (index.has(key)) {
    const e = index.get(key);
    e.count = (e.count ?? 1) + 1;
    return;
  }
  const entry = {
    startedDateTime: new Date(1765500000000 + i * 400).toISOString(),
    time: 120 + (i % 200),
    type: 'fetch',
    method: r.method,
    url: ORIGIN + r.url,
    status: r.status,
    mimeType: 'application/json',
    responseSize: JSON.stringify(r.body).length,
    initiator: { kind: 'script', via: 'src/features/data/useData.ts:18:11 (useData.useQuery)' },
    requestBody: r.reqBody ? compactBody(JSON.stringify(r.reqBody), undefined, CAPTURE_LIMITS) : null,
    responseBody: compactBody(JSON.stringify(r.body), undefined, CAPTURE_LIMITS),
  };
  index.set(key, entry);
  entries.push(entry);
});
const digest = entries.map((e) => recompactEntry(e, DETAIL_LEVELS.M, false));
const toonStr = encode(digest);

// ---- 4) + "1 per endpoint" chip: collapse query-param variations ----
const seenPaths = new Set();
const unique = entries.filter((e) => {
  const key = `${e.method} ${e.url.split('?')[0]}`;
  if (seenPaths.has(key)) return false;
  seenPaths.add(key);
  return true;
});
const toonUniqueStr = encode(unique.map((e) => recompactEntry(e, DETAIL_LEVELS.M, false)));

// ---- report ----
const t = { har: tokens(harStr), raw: tokens(rawBodiesStr), digest: tokens(toonStr), unique: tokens(toonUniqueStr) };
const bar = (n, max, width = 20) => {
  const filled = Math.max(n / max > 0 ? 1 : 0, Math.round((n / max) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};
const fmt = (n) => n.toLocaleString('en-US');
const pct = (n) => ((n / t.har) * 100).toFixed(n / t.har < 0.05 ? 1 : 0) + '%';

console.log(`Session: ${RAW.length} requests (big lists, 456-key settings, duplicate polls, query variants)\n`);
console.log(`HAR export (full)         ${bar(t.har, t.har)}  ${pct(t.har).padStart(5)}   ~${fmt(t.har)} tokens`);
console.log(`Raw JSON bodies           ${bar(t.raw, t.har)}  ${pct(t.raw).padStart(5)}   ~${fmt(t.raw)} tokens`);
console.log(`NetDigest (TOON, M)       ${bar(t.digest, t.har)}  ${pct(t.digest).padStart(5)}   ~${fmt(t.digest)} tokens`);
console.log(`  + "1 per endpoint"      ${bar(t.unique, t.har)}  ${pct(t.unique).padStart(5)}   ~${fmt(t.unique)} tokens`);
console.log(`\n→ ${(t.har / t.digest).toFixed(0)}× smaller than the HAR (${(t.har / t.unique).toFixed(0)}× with query variants collapsed).`);
