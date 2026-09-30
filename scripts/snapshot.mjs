// Serve a frozen copy of the working tree, so editing src/ never reloads a running test (docs/GRAPHICS_HANDOFF.md, "How to test").
// usage: node scripts/snapshot.mjs <name> <port>   copies the tree to $SNAP_DIR/<name> (default ../snap/<name>, node_modules symlinked,
// shots/ and .git left out) and serves it with hmr off (and fs.strict off: node_modules is a symlink to the real tree, and without it the
// fonts under /@fs/ came back 403, which every test that counts console errors then reported), no file watching and its OWN Vite dependency cache (every snapshot shares
// the symlinked node_modules, and one server re-optimising there made the others' pages fail with 504 Outdated Optimize Dep). Ctrl-C / kill to stop. Prints "ready <url>" when up.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';
const [name = 'snap', port = '5175'] = process.argv.slice(2);
const src = process.cwd();
const dir = resolve(process.env.SNAP_DIR || resolve(src, '..', 'snap'), name);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
execSync(`tar -C "${src}" --exclude=./node_modules --exclude=./shots --exclude=./.git --exclude=./dist --exclude=./dist-single -cf - . | tar -C "${dir}" -xf -`);
symlinkSync(resolve(src, 'node_modules'), resolve(dir, 'node_modules'));
writeFileSync(resolve(dir, 'vite.snap.config.mjs'), `import base from './vite.config.ts';
export default (env) => { const c = typeof base === 'function' ? base(env) : base; return { ...c, cacheDir: '${resolve(dir, '.vite-cache')}', server: { host: '127.0.0.1', port: ${Number(port)}, strictPort: true, hmr: false, watch: null, fs: { strict: false } } }; };`);
const server = await createServer({ root: dir, configFile: resolve(dir, 'vite.snap.config.mjs') });
await server.listen();
console.log(`ready http://127.0.0.1:${port} (${dir})`);
