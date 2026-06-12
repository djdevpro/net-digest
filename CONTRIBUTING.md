# Contributing to NetDigest

Thanks for your interest! NetDigest is a small, focused codebase: most contributions touch a handful of files.

## Dev setup

```bash
pnpm install
pnpm wxt prepare   # pnpm 10 blocks the postinstall script, run it once manually
pnpm dev           # opens Chrome with the extension loaded
```

Or load `.output/chrome-mv3` as an unpacked extension after `pnpm build`.
**After every rebuild**: reload the extension in `chrome://extensions`, then **close and reopen DevTools** (the devtools page is not reloaded automatically).

## Where things live

| Path | Role |
|---|---|
| `entrypoints/devtools/main.ts` | **Capture side**: runs as the devtools page: network listener, dedup, interaction recorder, sourcemap resolution. Owns the `NETDIGEST_BRIDGE` object. |
| `entrypoints/devtools-panel/` | **Display side**: pure UI, no extension APIs. Reads the bridge from its `window`. |
| `utils/compact.ts` | Truncation/redaction engine. Marker-aware: re-truncation must preserve original totals. |
| `utils/bridge.ts` | The capture↔panel contract + filtering helpers. |
| `utils/apimap.ts`, `utils/initiator.ts`, `utils/sourcemap.ts` | API map, initiator frame picking, minimal source-map consumer. |
| `landing/` | Static landing page; the demo iframe runs the **real panel bundle** fed by `demo-bridge.js`. |

Two invariants to respect:

1. **The panel must stay extension-API-free**: it is reused as-is by the landing demo.
2. **Compaction must stay marker-aware**: `recompactValue` parses its own markers (`…[+N items, M total]`, `…` object key) so totals always refer to the original data. If you add a marker format, teach the re-truncation pass about it.

## Checks

```bash
pnpm compile   # tsc --noEmit, must pass
pnpm build     # must produce a clean .output/chrome-mv3
pnpm landing   # optional: rebuilds the landing demo from the fresh bundle
```

There is no test runner wired up yet; if you add logic to `utils/`, a small standalone repro in the PR description is appreciated.

## Pull requests

- `main` is protected: work on a branch, open a PR.
- Keep PRs focused: one feature or fix per PR.
- Describe **what** and **why**; screenshots/exports welcome for UI or output-format changes.
- Plain commit messages, without AI co-author trailers.
- Privacy bar: nothing may send capture data anywhere. Auth headers and cookies must never be captured; secret redaction stays always-on.

## Reporting bugs

Use the bug template and include a TOON export excerpt when relevant (redact anything personal: the extension already redacts secrets, but double-check).
