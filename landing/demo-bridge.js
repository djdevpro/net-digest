// NetDigest landing demo: feeds the REAL panel (unmodified build) with scripted
// traffic through the same bridge contract the devtools page uses. Classic
// script - runs before the panel's module script.
(function () {
  'use strict';

  // The panel reads chrome.devtools.panels.themeName for theming → force dark.
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.devtools) window.chrome.devtools = { panels: { themeName: 'dark' } };

  var T0 = Date.now() - 60000;
  var iso = function (offsetMs) {
    return new Date(T0 + offsetMs).toISOString();
  };

  var API = 'https://api.example.dev';

  function marker(label, offsetMs) {
    return {
      type: 'marker',
      method: 'MARK',
      url: label,
      status: 0,
      time: 0,
      startedDateTime: iso(offsetMs),
      requestBody: null,
      responseBody: null,
    };
  }

  function article(id, title, author, likes, status) {
    return {
      id: id,
      title: title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      status: status || 'published',
      author: author,
      likes: likes,
      tags: ['changelog', 'product'],
      coverUrl: '/storage/articles/' + id + '/cover.webp',
      createdAt: '2026-06-0' + ((id % 8) + 1) + 'T09:12:00.000Z',
      updatedAt: '2026-06-11T16:40:00.000Z',
    };
  }

  // Capture-level entries (the panel itself re-truncates to S/M/L live).
  var SCRIPT = [
    marker('● recording started', 0),
    marker('page https://app.example.dev/dashboard', 30),
    {
      startedDateTime: iso(400),
      time: 76,
      type: 'fetch',
      method: 'GET',
      url: API + '/api/articles?perPage=20',
      status: 200,
      mimeType: 'application/json',
      responseSize: 18421,
      count: 12,
      initiator: { kind: 'script', via: 'src/features/articles/useArticles.ts:18:11 (useArticles.useQuery)' },
      responseHeaders: { 'cache-control': 'no-cache, private', etag: 'W/"a91c-Hx2"' },
      requestBody: null,
      responseBody: {
        success: true,
        data: {
          items: [
            article(1, 'Shipping NetDigest 1.0', 'Ada Lovelace', 42),
            article(2, 'Tokens are a budget', 'Grace Hopper', 31),
            article(3, 'Why TOON beats JSON for LLMs', 'Alan Kay', 27),
            article(4, 'Redaction by default', 'Barbara Liskov', 19, 'draft'),
            '…[+16 items, 20 total]',
          ],
          pagination: { total: 20, perPage: 20, page: 1, lastPage: 1 },
        },
        message: 'Articles fetched successfully',
      },
    },
    {
      startedDateTime: iso(700),
      time: 51,
      type: 'xhr',
      method: 'GET',
      url: API + '/api/auth/me',
      status: 200,
      mimeType: 'application/json',
      responseSize: 1204,
      initiator: { kind: 'script', via: 'src/auth/useCurrentUser.ts:12:9 (useCurrentUser.useQuery)' },
      requestBody: null,
      responseBody: {
        success: true,
        data: {
          id: 7,
          name: 'Jo Dev',
          email: 'jo@example.dev',
          role: 'admin',
          token: 'eyJhbGciOiJIUzI1NiJ9.demo.signature',
          preferences: { theme: 'dark', locale: 'en', notifications: true },
        },
      },
    },
    marker('click button "Sign in"', 1900),
    marker('submit form "login"', 1960),
    {
      startedDateTime: iso(2000),
      time: 112,
      type: 'fetch',
      method: 'POST',
      url: API + '/api/login',
      status: 401,
      mimeType: 'application/json',
      responseSize: 64,
      initiator: { kind: 'script', via: 'src/auth/LoginForm.tsx:41:20 (LoginForm.useMutation[signIn])' },
      requestBody: { email: 'jo@example.dev', password: 'hunter2', remember: true },
      responseBody: { success: false, message: 'Invalid credentials' },
    },
    {
      startedDateTime: iso(2600),
      time: 138,
      type: 'fetch',
      method: 'POST',
      url: API + '/api/login',
      status: 200,
      mimeType: 'application/json',
      responseSize: 301,
      initiator: { kind: 'script', via: 'src/auth/LoginForm.tsx:41:20 (LoginForm.useMutation[signIn])' },
      requestBody: { email: 'jo@example.dev', password: 'hunter2', remember: true },
      responseBody: {
        success: true,
        data: { user: { id: 7, name: 'Jo Dev' }, token: 'eyJhbGciOiJIUzI1NiJ9.demo.signature', authenticated: true },
        message: 'User login successfully.',
      },
    },
    marker('navigate https://app.example.dev/articles', 3400),
    {
      startedDateTime: iso(3600),
      time: 95,
      type: 'fetch',
      method: 'POST',
      url: API + '/api/search',
      status: 200,
      mimeType: 'application/json',
      responseSize: 2210,
      initiator: { kind: 'script', via: 'src/search/useSearch.ts:24:15 (useSearch.useQuery)' },
      requestBody: { q: 'release notes', filters: { tags: ['changelog'], after: '2026-01-01' } },
      responseBody: {
        success: true,
        data: {
          hits: [
            { id: 1, title: 'Shipping NetDigest 1.0', score: 0.98 },
            { id: 3, title: 'Why TOON beats JSON for LLMs', score: 0.91 },
            '…[+6 items, 8 total]',
          ],
          tookMs: 12,
        },
      },
    },
    {
      startedDateTime: iso(4100),
      time: 64,
      type: 'fetch',
      method: 'GET',
      url: API + '/api/articles/42',
      status: 404,
      mimeType: 'application/json',
      responseSize: 52,
      initiator: { kind: 'script', via: 'src/features/articles/useArticle.ts:9:13 (useArticle.useQuery)' },
      requestBody: null,
      responseBody: { success: false, message: 'Article not found' },
    },
    {
      startedDateTime: iso(4600),
      time: 142,
      type: 'fetch',
      method: 'PUT',
      url: API + '/api/articles/3',
      status: 200,
      mimeType: 'application/json',
      responseSize: 880,
      initiator: { kind: 'script', via: 'src/features/articles/Editor.tsx:88:17 (Editor.useMutation[saveArticle])' },
      requestBody: { title: 'Why TOON beats JSON for LLMs', content: { html: '<p>Fewer braces, fewer tokens…</p>', pinned: true } },
      responseBody: { success: true, data: article(3, 'Why TOON beats JSON for LLMs', 'Alan Kay', 28), message: 'Article updated' },
    },
    {
      startedDateTime: iso(5200),
      time: 71,
      type: 'fetch',
      method: 'POST',
      url: API + '/api/links/count-batch',
      status: 200,
      mimeType: 'application/json',
      responseSize: 793,
      initiator: { kind: 'script', via: 'src/links/useLinkedCounts.ts:31:12 (useLinkedCounts.useQuery)' },
      requestBody: { ids: [4423, 4424, 4425, 4426, '…[+4 items, 8 total]'] },
      responseBody: {
        success: true,
        data: {
          4423: { total: 0, todo: 0, inProgress: 0, completed: 0, links: [] },
          4424: { total: 0, todo: 0, inProgress: 0, completed: 0, links: [] },
          4425: { total: 0, todo: 0, inProgress: 0, completed: 0, links: [] },
          4426: { total: 3, todo: 1, inProgress: 1, completed: 1, links: [] },
        },
      },
    },
  ];

  var POLL = {
    startedDateTime: iso(5600),
    time: 48,
    type: 'xhr',
    method: 'GET',
    url: API + '/api/notifications/poll',
    status: 200,
    mimeType: 'application/json',
    responseSize: 167,
    count: 1,
    initiator: { kind: 'script', via: 'src/notifications/usePolling.ts:14:10 (usePolling.useQuery)' },
    requestBody: null,
    responseBody: { success: true, data: { unread: 2, items: [{ id: 901, kind: 'mention', read: false }] } },
  };

  var bridge = {
    entries: [],
    dropped: 0,
    error: null,
    onChange: null,
    pageHost: 'app.example.dev',
    recording: true,
    setRecording: function (on) {
      if (on === bridge.recording) return;
      bridge.recording = on;
      push(marker(on ? '● recording started' : 'recording stopped', Date.now() - T0));
    },
    remove: function (list) {
      for (var i = bridge.entries.length - 1; i >= 0; i--) {
        if (list.indexOf(bridge.entries[i]) !== -1) bridge.entries.splice(i, 1);
      }
    },
    reset: function () {
      bridge.entries.length = 0;
      bridge.dropped = 0;
      bridge.error = null;
      restart();
    },
  };

  function notify() {
    try {
      if (bridge.onChange) bridge.onChange();
    } catch (e) {
      bridge.onChange = null;
    }
  }

  function push(entry) {
    bridge.entries.push(entry);
    notify();
  }

  var timers = [];
  var pollTimer = null;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function play() {
    SCRIPT.forEach(function (entry, i) {
      timers.push(
        setTimeout(function () {
          push(JSON.parse(JSON.stringify(entry)));
        }, 350 + i * 420),
      );
    });
    // after the script: a polling endpoint that keeps deduping (live "listening" feel)
    timers.push(
      setTimeout(function () {
        var poll = JSON.parse(JSON.stringify(POLL));
        push(poll);
        pollTimer = setInterval(function () {
          if (poll.count >= 30) return;
          poll.count += 1;
          notify();
        }, 3000);
      }, 350 + SCRIPT.length * 420 + 600),
    );
  }

  function restart() {
    clearTimers();
    setTimeout(play, 400);
  }

  window.NETDIGEST_BRIDGE = bridge;
  play();
})();
