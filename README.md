# NetDigest

DevTools extension that captures network traffic and produces a **compact** export ready to paste into an LLM: full structure preserved, values truncated, identical calls deduped, encoded as token-efficient [TOON](https://github.com/toon-format/toon).

## Compaction rules (`utils/compact.ts`)

- **All object keys are always kept** (shape is sacred; 500-key safety guard). The levers are strings, arrays and **depth**: capture keeps 1024 chars / 8 items / depth 10; exports re-truncate to **S** (64 / 1 / depth 3), **M** (255 / 3 / depth 6, default) or **L** (capture fidelity). Content beyond the depth limit becomes a descriptive stub: `…[object, 43 keys]`.
- **Repeated structures are collapsed**: sibling values that are identical after compaction become `…[same as "4423"]` / `…[same as item 0]` — APIs returning N copies of the same object cost almost nothing.
- **Array items after the first are diffed against item 0**: they only show fields whose values differ, plus `…: "[7 keys same as item 0]"`. The first item establishes the full shape; the rest stays reconstructible at half the tokens.
- Re-truncation is marker-aware: totals always refer to the original data; non-JSON bodies truncated as text
- **Initiator**: every request carries the code location that fired it (`at: /chunks/abc.js:41:12 (useArticles)` + up to 2 more frames) and a 3-line source snippet around the call site (read via `getResources`, windowed for minified bundles). At S level only the location is kept.
- **Secrets are always redacted** (`***`): sensitive keys (password, token, api-key, authorization, cookie, session…), JWT/Bearer-looking values, `key=value` form fields. Auth headers and cookies are never captured at all.

## Extras

- **API map** button: condensed contract of the captured API — endpoints normalized (`/articles/42` → `/articles/:id`), statuses, query keys, first-sample request/response shapes. Copied + previewed.
- **Markers**: insert `⚑ Step N` rows in the timeline (e.g. before clicking a button) so an LLM can correlate actions with requests.
- **headers** chip: opt-in whitelisted debug headers (cache, CORS, tracing) in exports.
- Icons: `public/icon.svg` → `pnpm icons` regenerates the PNGs; `pnpm zip` produces the store package; store listing draft in `store/LISTING.md`.

## Usage

```bash
pnpm install
pnpm dev          # opens Chrome with the extension loaded
```

1. In the launched Chrome (or after loading `.output/chrome-mv3` unpacked), open your target page
2. Open DevTools (`F12`) → **NetDigest** tab (sometimes hidden behind `»`) — capture starts as soon as DevTools opens
3. Reload the page: requests appear (capture only works while DevTools is open)
4. Filters: `XHR/Fetch` + `same domain` (inspected page + subdomains; kills analytics/CDN/consent noise) + search box (space-separated terms over method/status/URL) — settings persist across sessions. Identical calls (method+URL+status) are merged into one `×N` entry (`count` in the export). The status bar shows the estimated token cost of the export; every export starts with a preamble explaining the truncation markers to the model.
5. Selection: click, `Ctrl+click` (add/remove), `Shift+click` (range), `Esc` (clear) — the selection survives filter changes, handy for cherry-picking endpoints across searches
6. **Copy TOON** or **Download TOON**: exports the selection if any, otherwise everything the filter shows
7. Panes are resizable (drag the divider, double-click to reset); theme follows DevTools (light/dark) automatically

## Structure

- `entrypoints/devtools/` — **capture side**: listens to `devtools.network` from the moment DevTools opens, compacts, dedupes, buffers (500 max) and registers the panel tab
- `entrypoints/devtools-panel/` — **display side**: receives the buffer through `NETDIGEST_BRIDGE` (attached by `panel.onShown`), list + preview with TOON syntax highlighting + export
- `utils/compact.ts` — recursive truncation logic; `utils/bridge.ts` — capture↔panel contract and same-site helpers

After each `pnpm build`: reload the extension in `chrome://extensions` **then close/reopen DevTools** (the devtools page is not reloaded automatically).
