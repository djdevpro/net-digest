# NetDigest — Store visuals: image-generation prompts

**Usage (FR).** Deux prompts indépendants, un par visuel. Colle `STYLE CORE + PROMPT 1` (ou 2) comme UN SEUL message dans ton générateur d'images (GPT-image, Gemini/Imagen, Flux, Ideogram…). Si l'outil a un champ "system", mets-y le STYLE CORE et le reste en message. Ajoute le NEGATIVE PROMPT si l'outil le supporte. Les modèles ne sortent jamais des pixels exacts : génère au ratio le plus proche puis redimensionne/recadre (notes en bas).

---

## STYLE CORE (shared — paste at the top of both prompts)

Steel-blue developer-tool aesthetic, dark and metallic, SOFT CONTRAST (no pure black, no pure white).
Exact palette: background gradient #141923 → #1b212b; raised surfaces #232b37; hairline borders #36404f; off-white text #d5dce5; muted grey-blue #8b97a6; steel-blue accent #3a6ea5 with highlight #5e92cc; light accent #8ab8e8; soft green #82b899; soft red #d68f88; soft amber #d4af6e.
Flat, ultra-clean vector UI rendering, perfectly straight 1px lines, crisp edges, premium product-shot quality.
CRITICAL TEXT RULE: render ONLY the exact strings quoted in this prompt as legible text; render every other text area as soft blurred grey placeholder bars (greeked text). No random letters anywhere.

## PROMPT 1 — Promotional screenshot (final size 1280×800, ratio 16:10)

Landscape 16:10 product showcase of a Chrome DevTools extension panel called NetDigest.

SCENE: dark steel-blue workspace backdrop (gradient #141923 → #1b212b), one soft cyan-blue glow halo behind the center. A single front-facing floating panel card, rounded corners, thin #36404f border, gentle drop shadow, filling ~80% of the frame.

PANEL CONTENT (crisp, flat, dark slate #1b212b):
- Top toolbar on #232b37: left, a small glowing gradient dot (#5e92cc → #3a6ea5) beside the bold wordmark "NetDigest" in #d5dce5. Right-aligned compact buttons with thin line icons: "API map", "Copy TOON" (filled steel-blue #3a6ea5, white label), "Download", "Clear".
- Second toolbar row: three rounded pill chips "XHR/Fetch", "same domain", "headers" — the first two active (soft blue fill, glowing dot), the third inactive grey; a small segmented control "S | M | L" with "M" highlighted; a tiny flag button "Mark"; muted status text "24 shown / 57 captured • ≈ 3.2k tokens — listening ✓".
- Left pane (~45% width): rounded search field with magnifier icon and placeholder "Filter: URL, method, status…"; below, a vertical list of request rows in monospace — bold methods "GET" / "POST", status numbers in soft green "200" and soft red "401", small amber badges "×12", truncated URLs like "api.example.app/api/articles", right-aligned grey timings "76 ms". One row selected with a translucent steel-blue tint and a 2px blue left bar. One dashed amber-blue marker row with a small flag "⚑ Step 1".
- Thin vertical divider, then right pane (~55%): syntax-highlighted TOON code — property keys in light steel blue #85aedd, quoted strings in soft copper #cf9e74, numbers in lilac #ab96dd, the word "null" in teal #76b8b0, and grey italic truncation markers "…[truncated, 2000 chars total]", "…[+47 items, 50 total]", "***".

LIGHT & MOOD: calm, metallic, faint blue rim light on the panel edges.
FORBIDDEN: people, hands, browser window frame, Chrome logo, watermarks.
SAFE AREA: keep all content inside the central 90% of the frame (it will be cropped to exactly 1280×800).
FINAL REMINDER: respect the exact palette above and the CRITICAL TEXT RULE — only the quoted strings are legible, everything else is blurred placeholder bars.

## PROMPT 2 — Small promo tile (final size 440×280, ratio ~11:7)

Minimal landscape promo tile for the developer tool NetDigest, bold and readable at small size.

COMPOSITION: dark steel gradient backdrop (#141923 → #1f2733). Slightly left of center, the app icon: a rounded-square dark slate tile (#1b212b, thin #36404f border, soft blue under-glow) containing three horizontal rounded bars of decreasing width in a steel-blue gradient (#5e92cc → #3a6ea5) and a small light-blue dot #8ab8e8 near the lower right. To its right, the wordmark "NetDigest" in bold #d5dce5, with one thin tagline below in #8b97a6: "Network → tokens". Background: an oversized ghost of code lines rendered as blurred grey bars at ~8% opacity.

STYLE: flat vector, metallic, soft contrast, crisp edges, generous empty space.
TEXT RULE: only "NetDigest" and "Network → tokens" are legible; everything else abstract.
FORBIDDEN: people, gibberish text, browser chrome, Chrome logo, watermark.
SAFE AREA: central 90%; final crop 440×280.
FINAL REMINDER: exact palette, only the two quoted strings as text.

## NEGATIVE PROMPT (append where supported)

gibberish text, random letters, misspelled words, rainbow colors, purple-pink neon, glassmorphism, photorealistic people, hands, 3D clay render, skeuomorphism, Chrome logo, browser window frame, watermark, signature, blurry UI lines, double borders, harsh pure-black shadows

## Engine adaptations & resizing

- **Midjourney v6/v7**: append `--ar 16:10 --stylize 100` (prompt 1) / `--ar 11:7 --stylize 100` (prompt 2). Keep the text rule — MJ text is unreliable; expect to fix labels in an editor if needed.
- **GPT-image / Gemini Imagen / Flux**: best text fidelity. Ask for 1536×960 (prompt 1) or 1408×896 (prompt 2 fallback: square then crop), then downscale/crop to exact 1280×800 / 440×280.
- Exact pixel dimensions are never native — always finish with a resize/crop. Keep the panel inside the safe area so the crop never cuts UI.

## Note Chrome Web Store (FR)

Pour le slot "screenshots" du store, au moins une **vraie capture** du panneau (fenêtre réelle, 1280×800) est recommandée — une UI entièrement générée peut être considérée comme trompeuse en review. Utilise l'image générée du Prompt 1 comme visuel marketing/hero, et le Prompt 2 pour le small promo tile (440×280), où le style promotionnel est attendu.
