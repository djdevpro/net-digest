// Minimal source-map consumer: enough to map a bundled (line, col) back to the
// original file/line and grab the original source from sourcesContent. Dev
// servers (Next/Turbopack/webpack/Vite) embed sourcesContent in their dev maps.

export interface RawSourceMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
}

export interface MapHit {
  srcIdx: number;
  origLine: number; // 0-based
  origCol: number; // 0-based
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHAR_TO_INT = new Map<string, number>([...B64].map((c, i) => [c, i]));

/** Single linear pass over the mappings, stops at the target line. */
export function resolveInMap(map: RawSourceMap, genLine0: number, genCol0: number): MapHit | null {
  const { mappings } = map;
  let line = 0;
  let genCol = 0;
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  let candidate: MapHit | null = null; // last segment with genCol <= target on the line
  let firstOfLine: MapHit | null = null;

  let i = 0;
  const n = mappings.length;
  while (i < n && line <= genLine0) {
    const ch = mappings[i];
    if (ch === ';') {
      line++;
      genCol = 0;
      i++;
      continue;
    }
    if (ch === ',') {
      i++;
      continue;
    }
    // decode one segment (1, 4 or 5 VLQ values)
    const seg: number[] = [];
    while (i < n && mappings[i] !== ',' && mappings[i] !== ';') {
      let result = 0;
      let shift = 0;
      let cont = true;
      while (cont) {
        const digit = CHAR_TO_INT.get(mappings[i]);
        i++;
        if (digit === undefined) return candidate ?? firstOfLine; // malformed
        cont = (digit & 32) !== 0;
        result += (digit & 31) << shift;
        shift += 5;
      }
      seg.push(result & 1 ? -(result >>> 1) : result >>> 1);
    }
    genCol += seg[0];
    if (seg.length >= 4) {
      srcIdx += seg[1];
      origLine += seg[2];
      origCol += seg[3];
      if (line === genLine0) {
        const hit: MapHit = { srcIdx, origLine, origCol };
        if (!firstOfLine) firstOfLine = hit;
        if (genCol <= genCol0) candidate = hit;
        else if (candidate) break; // past the target column with a match in hand
      }
    }
  }
  return candidate ?? firstOfLine;
}

/** Last sourceMappingURL reference in a chunk (handles huge inline data: URIs). */
export function findSourceMappingURL(content: string): string | null {
  const i = content.lastIndexOf('sourceMappingURL=');
  if (i === -1) return null;
  const ref = content.slice(i + 'sourceMappingURL='.length).split(/[\s*]/, 1)[0];
  return ref || null;
}

/** turbopack://[project]/src/x.ts → src/x.ts ; webpack://_N_E/./src/x.ts → src/x.ts */
export function cleanSourcePath(s: string): string {
  return s
    .replace(/^turbopack:\/\/\[project\]\//, '')
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}
