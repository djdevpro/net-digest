import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { cleanSourcePath, findSourceMappingURL, resolveInMap } from './sourcemap';

describe('resolveInMap', () => {
  it('maps a minified position back to the original file and line (real esbuild map)', () => {
    const src = 'export function useUsersMe(){\n  const q = init();\n  return fetch("/api/users/me");\n}\n';
    const out = transformSync(src, {
      minify: true,
      sourcemap: true,
      sourcefile: 'turbopack://[project]/src/hooks/useUsers.ts',
    });
    const map = JSON.parse(out.map);
    const genCol = out.code.indexOf('fetch(');
    expect(genCol).toBeGreaterThan(0);

    const hit = resolveInMap(map, 0, genCol)!;
    expect(hit).toBeTruthy();
    expect(map.sources[hit.srcIdx]).toContain('useUsers.ts');
    expect(hit.origLine).toBe(2); // 0-based: the fetch sits on source line 3
    expect(map.sourcesContent?.[hit.srcIdx]).toContain('useUsersMe');
  });

  it('returns null on unmappable input', () => {
    expect(resolveInMap({ version: 3, sources: [], mappings: '' }, 0, 10)).toBeNull();
  });
});

describe('findSourceMappingURL', () => {
  it('finds file references and huge inline data URIs', () => {
    expect(findSourceMappingURL('code;\n//# sourceMappingURL=chunk.js.map')).toBe('chunk.js.map');
    const data = findSourceMappingURL('x;\n//# sourceMappingURL=data:application/json;base64,' + 'A'.repeat(5000));
    expect(data?.startsWith('data:application/json')).toBe(true);
    expect(data!.length).toBeGreaterThan(5000);
    expect(findSourceMappingURL('no map here')).toBeNull();
  });
});

describe('cleanSourcePath', () => {
  it('strips bundler prefixes', () => {
    expect(cleanSourcePath('turbopack://[project]/src/hooks/useUsers.ts')).toBe('src/hooks/useUsers.ts');
    expect(cleanSourcePath('webpack://_N_E/./src/x.ts')).toBe('src/x.ts');
  });
});
