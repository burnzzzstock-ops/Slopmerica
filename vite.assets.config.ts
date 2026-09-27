import { realpathSync } from 'node:fs';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist-assets', target: 'es2020', chunkSizeWarningLimit: 800, rollupOptions: { input: 'asset-library.html' } },
  server: {
    host: '127.0.0.1', port: 5174,
    // Also support worktrees that reuse installed dependencies through a junction.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')] },
  },
});
