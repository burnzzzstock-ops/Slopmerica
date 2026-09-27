import { realpathSync } from 'node:fs';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
export default defineConfig({
  base:'./',
  cacheDir:'node_modules/.vite-asset-vault',
  publicDir:'vault-public',
  build:{outDir:'dist/asset-vault',target:'es2020',chunkSizeWarningLimit:850,rollupOptions:{input:['asset-vault.html','asset-vault-overview.html']}},
  server:{host:'127.0.0.1',port:5176,
    watch:{ignored:['**/vault-public/**','**/shots/**','**/dist/**']},
    fs:{allow:[searchForWorkspaceRoot(process.cwd()),realpathSync('node_modules')]}},
});
