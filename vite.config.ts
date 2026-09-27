import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * public/ isn't copied (the asset catalogs are big): ship only the packs the
 * game streams in beside the page (Civic Foundry street furniture, the Asset
 * Vault's buildings). The single-file build is published where .bin isn't
 * served, so its geometry goes as base64 text (pack.json names it).
 */
function gamePacks(outDir: string, text: boolean): Plugin {
  return {
    name: 'slop-game-packs',
    apply: 'build',
    closeBundle() {
      for (const name of ['civic', 'vault']) {
        const src = resolve('public', name);
        if (!existsSync(src)) continue;
        const out = resolve(outDir, name);
        cpSync(src, out, { recursive: true });
        if (!text) continue;
        writeFileSync(resolve(out, 'pack.b64.txt'), readFileSync(resolve(out, 'pack.bin')).toString('base64'));
        rmSync(resolve(out, 'pack.bin'));
        const json = JSON.parse(readFileSync(resolve(out, 'pack.json'), 'utf8'));
        writeFileSync(resolve(out, 'pack.json'), JSON.stringify({ ...json, bin64: 'pack.b64.txt' }));
      }
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
