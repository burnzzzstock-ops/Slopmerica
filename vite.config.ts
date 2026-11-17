import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * public/ isn't copied (the asset catalogs are big): ship only the packs the
 * game streams in (Civic Foundry street furniture, the Asset Vault's
 * buildings). The normal build puts them beside the page. The single-file
 * build is one HTML file that must work opened from disk, where nothing
 * beside it can be fetched: each pack goes inside the page, its geometry as
 * base64 text and the textures it names as data URIs (src/core/pack.ts
 * reads them there first).
 */
function gamePacks(outDir: string, single: boolean): Plugin {
  const IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const inline = (dir: string, v: unknown): unknown => {
    if (typeof v === 'string') {
      const type = IMAGE[v.split('.').pop()!.toLowerCase()], f = resolve(dir, v);
      return type && existsSync(f) ? `data:${type};base64,${readFileSync(f).toString('base64')}` : v;
    }
    if (Array.isArray(v)) return v.map((x) => inline(dir, x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inline(dir, x)]));
    return v;
  };
  return {
    name: 'slop-game-packs',
    apply: 'build',
    closeBundle() {
      let tags = '';
      for (const name of ['civic', 'vault']) {
        const src = resolve('public', name);
        if (!existsSync(src)) continue;
        if (!single) { cpSync(src, resolve(outDir, name), { recursive: true }); continue; }
        const json = inline(src, JSON.parse(readFileSync(resolve(src, 'pack.json'), 'utf8')));
        tags += `<script type="application/json" id="slop-pack-${name}">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>`;
        tags += `<script type="text/plain" id="slop-pack-${name}-bin">${readFileSync(resolve(src, 'pack.bin')).toString('base64')}</script>`;
      }
      if (!tags) return;
      const page = resolve(outDir, 'index.html');
      writeFileSync(page, readFileSync(page, 'utf8').replace('</body>', () => `${tags}</body>`));
    },
  };
}

// short commit + date, shown on the title screen and in bug reports
function buildId() {
  let rev = 'local';
  try {
    rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) rev += '+';
  } catch { /* not a git checkout */ }
  return `${rev} · ${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __BUILD__: JSON.stringify(buildId()) },
  plugins: [...(mode === 'single' ? [viteSingleFile()] : []), gamePacks(mode === 'single' ? 'dist-single' : 'dist', mode === 'single')],
  build: {
    // The optional art library has its own catalog build; keep game downloads lean.
    copyPublicDir: false,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
  server: { host: '127.0.0.1', port: 5173, watch: { ignored: ['**/shots/**', '**/dist/**', '**/dist-single/**', '**/scripts/**', '**/vault-public/**', '**/public/asset-library/**'] } },
}));
