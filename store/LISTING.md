# Chrome Web Store listing — NetDigest

## Name
NetDigest

## Short description (≤132 chars)
Compact network capture for DevTools: deduped, redacted, truncated and exported as token-efficient TOON for LLM debugging.

## Category
Developer Tools

## Full description

NetDigest is a DevTools panel that turns noisy network traffic into a compact, shareable digest — small enough to paste into an LLM, complete enough to debug with.

WHAT IT DOES
• Captures XHR/fetch traffic from the moment DevTools opens (HAR-grade data, including request payloads and response bodies)
• Recursively truncates values while preserving the full object shape (strings, arrays, base64/binary)
• Merges identical calls (same method+URL+status) into a single ×N entry
• Redacts secrets automatically: passwords, tokens, API keys, JWTs — they never even reach memory
• Exports as TOON (Token-Oriented Object Notation), with a preamble that explains the truncation markers to the model

WORKFLOW
• Filter by XHR/fetch, same-domain (kills analytics/CDN/consent noise) and free-text search
• Cherry-pick endpoints with Ctrl+click / Shift+click — the export contains exactly your selection
• Choose the export detail (S/M/L) and watch the estimated token cost live
• Insert timeline markers ("clicked Save") so the model can correlate actions with requests
• One-click API map: endpoints normalized (/articles/42 → /articles/:id), statuses, query keys and example shapes — the contract of your API in a few dozen lines

PRIVACY
• No data collection, no analytics, no remote servers. Everything stays in your DevTools.
• Auth headers and cookies are never captured; sensitive values are redacted at capture time.
• Capture only runs while DevTools is open, on the page you are inspecting.

## Permission justification
- clipboardWrite: lets the "Copy TOON" / "API map" buttons place the export on the clipboard.

## Privacy policy (single purpose statement)
NetDigest processes network traffic of the inspected page locally, inside the DevTools session, for the sole purpose of displaying and exporting a compacted version of it. No data is collected, stored remotely, or transmitted anywhere.

## Assets checklist
- [ ] Screenshots 1280×800 (panel with capture + preview, API map view, light theme)
- [ ] Small promo tile 440×280 (optional)
- [x] Icon 128×128 (public/icon/128.png)
- [x] Zip: .output/netdigest-1.0.0-chrome.zip
