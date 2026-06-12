// Assembles the landing page from the REAL extension build: the demo iframe
// loads the unmodified devtools-panel bundle, fed by landing/demo-bridge.js.
// Usage: pnpm landing   (runs wxt build first via the package script)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';

const SRC = '.output/chrome-mv3';
const OUT = 'landing/dist';

if (!existsSync(`${SRC}/devtools-panel.html`)) {
  console.error('No extension build found — run `pnpm build` first.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/app`, { recursive: true });

for (const dir of ['chunks', 'assets']) {
  cpSync(`${SRC}/${dir}`, `${OUT}/app/${dir}`, { recursive: true });
}

// demo.html = the real panel page, with root-relative URLs made relative
// (GitHub Pages serves under /net-digest/) and the demo bridge injected
// BEFORE the panel module script (classic script in <head> runs first).
let html = readFileSync(`${SRC}/devtools-panel.html`, 'utf8');
html = html.replaceAll('"/chunks/', '"./chunks/').replaceAll('"/assets/', '"./assets/');
html = html.replace('</head>', '  <script src="./demo-bridge.js"></script>\n</head>');
writeFileSync(`${OUT}/app/demo.html`, html);

cpSync('landing/demo-bridge.js', `${OUT}/app/demo-bridge.js`);
cpSync('landing/index.html', `${OUT}/index.html`);
cpSync('public/icon.svg', `${OUT}/icon.svg`);

console.log('landing/dist ready — preview with:  npx serve landing/dist');
