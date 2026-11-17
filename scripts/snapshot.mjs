// Serve a frozen copy of the working tree, so editing src/ never reloads a running test (docs/GRAPHICS_HANDOFF.md, "How to test").
// usage: node scripts/snapshot.mjs <name> <port>   copies the tree to $SNAP_DIR/<name> (default ../snap/<checkout>-<name>; node_modules linked,
// shots/, docs/, the builds and .git left out) and serves it with hmr off (and fs.strict off: node_modules is a link to the real tree, and
// without it the fonts under /@fs/ came back 403, which every test that counts console errors then reported), no file watching and its OWN
// Vite dependency cache (every snapshot shares the linked node_modules, and one server re-optimising there made the others' pages fail with
// 504 Outdated Optimize Dep). Ctrl-C / kill to stop. Prints "ready <url>" when up.
// Works on Windows without admin rights: the copy is Node's own (no tar), and node_modules is a directory junction there.
import { cpSync, lstatSync, mkdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { createServer } from 'vite';
const [name = 'snap', port = '5175'] = process.argv.slice(2);
const src = process.cwd();
const dir = process.env.SNAP_DIR ? resolve(process.env.SNAP_DIR, name) : resolve(src, '..', 'snap', `${basename(src)}-${name}`);
const LEAVE = new Set(['node_modules', 'shots', '.git', 'dist', 'dist-single', 'dist-assets', 'docs', 'vault-public']);
// take the link to node_modules away first, so clearing the old copy can never reach into the real one
const link = resolve(dir, 'node_modules');
try { if (lstatSync(link)) { try { unlinkSync(link); } catch { rmdirSync(link); } } } catch { /* no old copy */ }
rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(dir, { recursive: true });
cpSync(src, dir, { recursive: true, filter: (p) => !LEAVE.has(relative(src, p).split(sep)[0]) });
symlinkSync(resolve(src, 'node_modules'), link, 'junction');   // (the type only matters on Windows)
writeFileSync(resolve(dir, 'vite.snap.config.mjs'), `import base from './vite.config.ts';
export default (env) => { const c = typeof base === 'function' ? base(env) : base; return { ...c, cacheDir: ${JSON.stringify(resolve(dir, '.vite-cache'))}, server: { host: '127.0.0.1', port: ${Number(port)}, strictPort: true, hmr: false, watch: null, fs: { strict: false } } }; };`);
const server = await createServer({ root: dir, configFile: resolve(dir, 'vite.snap.config.mjs') });
await server.listen();
console.log(`ready http://127.0.0.1:${port} (${dir})`);
