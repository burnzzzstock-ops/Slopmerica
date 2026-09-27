import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** public/ isn't copied (the asset catalog is big): ship only the game's Civic Foundry pack beside the page. */
function civicPack(outDir: string): Plugin {
  return {
    name: 'slop-civic-pack',
    apply: 'build',
    closeBundle() {
      const src = resolve('public/civic');
      if (existsSync(src)) cpSync(src, resolve(outDir, 'civic'), { recursive: true });
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
  plugins: [...(mode === 'single' ? [viteSingleFile()] : []), civicPack(mode === 'single' ? 'dist-single' : 'dist')],
  build: {
    // The optional art library has its own catalog build; keep game downloads lean.
    copyPublicDir: false,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
  server: { host: '127.0.0.1', port: 5173, watch: { ignored: ['**/shots/**', '**/dist/**', '**/dist-single/**', '**/scripts/**'] } },
}));
