// Renders public/icon.svg to the PNG sizes the manifest expects.
// Usage: pnpm icons
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
mkdirSync(new URL('../public/icon/', import.meta.url), { recursive: true });

for (const size of [16, 32, 48, 96, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), png);
  console.log(`icon/${size}.png`);
}
