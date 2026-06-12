# Changelog

## 1.1.0 (2026-06-12)

- Public landing page at https://djdevpro.github.io/net-digest/ embedding the real panel on scripted demo traffic, with a marquee feature carousel, full SEO layer (Open Graph, JSON-LD, sitemap) and mobile spacing.
- Marketing README with a measured token benchmark (pnpm bench: about 7x smaller than a HAR export).
- Community standards: license, contributing guide, code of conduct, security policy, issue and PR templates.
- Quality gates: vitest suite (42 tests over the compaction, redaction, filtering, initiator and sourcemap logic) wired into CI; merges to main require green checks.
- Release automation: this workflow builds, tests, zips and publishes the extension package.
- Extension polish: subtle button gradients and shadows, humanized UI texts.

## 1.0.0 (2026-06-12)

Initial release.

- Network capture from the DevTools page (works from the moment DevTools opens), dedup of identical calls (`count`), 500-entry buffer.
- Marker-aware compaction: all object keys kept, S/M/L detail levels (strings / array items / depth), per-endpoint overrides, diff-against-item-0 for array items, collapse of identical sibling structures.
- Always-on secret redaction (`***`); auth headers and cookies never captured.
- Interaction recorder: clicks, form submits and SPA navigations become timeline steps; `page` marker on start.
- Initiators resolved through source maps to the original file/hook (`src/hooks/useX.ts:12:9 (useX.useQuery)`).
- API map: normalized endpoint contract (methods, statuses, query keys, example shapes).
- TOON export (copy/download) with explanatory preamble and capture context; live token estimate.
- Filters: API only (errors always kept), same domain, flow only, 1 per endpoint, free-text search; row curation (Del / ×).
- Steel-blue UI, light/dark following DevTools, resizable panes, TOON syntax highlighting.
- Static landing page embedding the real panel bundle with scripted demo traffic (`pnpm landing`).
