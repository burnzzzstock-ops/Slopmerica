// The gate: what must pass before every commit, in under two minutes (npm run gate).
//   1. typecheck (tsc --noEmit)
//   2. the production build, and its size against scripts/budgets.json (fails when the main JS grows more than the budget allows)
//   3. the tests that need no browser (tier "gate" in scripts/tests/*.json)
//   4. the registry lint (every script listed, one browser launcher)
// The four run side by side; each one's output goes to shots/gate/<step>.log and the table says where to look.
// usage: node scripts/gate.mjs [--update-budget]   (--update-budget writes today's sizes to scripts/budgets.json: its own commit, saying why)
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { killTree, start } from './lib/proc.mjs';

const OUT = 'shots/gate';
mkdirSync(OUT, { recursive: true });
const BUDGETS = 'scripts/budgets.json';
const update = process.argv.includes('--update-budget');

const step = (name, cmd, args, limit = 180) => new Promise((resolve) => {
  const t0 = Date.now(), log = join(OUT, `${name}.log`);
  let out = '';
  const p = start(cmd, args);
  const on = (b) => { out += b; };
  p.stdout.on('data', on); p.stderr.on('data', on);
  const timer = setTimeout(() => { out += `\n(killed after ${limit} s)\n`; killTree(p); }, limit * 1000);
  p.on('error', (e) => { out += `\ncould not start: ${e.message}\n`; });
  p.on('close', (code) => { clearTimeout(timer); writeFileSync(log, out); resolve({ name, ok: code === 0, secs: (Date.now() - t0) / 1000, log, out }); });
});

/** The built game's script sizes, raw and gzipped: the biggest file under dist/assets is the main bundle. */
function sizes() {
  const dir = 'dist/assets';
  const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ f, bytes: statSync(join(dir, f)).size })).sort((a, b) => b.bytes - a.bytes);
  if (!js.length) throw new Error('no script in dist/assets');
  return { mainJs: js[0].bytes, mainJsGzip: gzipSync(readFileSync(join(dir, js[0].f))).length };
}

const results = await Promise.all([
  step('typecheck', 'node', ['node_modules/typescript/bin/tsc', '--noEmit']),
  step('build', 'node', ['node_modules/vite/bin/vite.js', 'build']).then((r) => {
    if (!r.ok) return r;
    try {
      const now = sizes(), budget = JSON.parse(readFileSync(BUDGETS, 'utf8'));
      if (update) { writeFileSync(BUDGETS, JSON.stringify({ ...budget, mainJs: now.mainJs, mainJsGzip: now.mainJsGzip }, null, 2) + '\n'); return { ...r, note: `budget set to ${now.mainJs} bytes (${now.mainJsGzip} gzip)` }; }
      const over = now.mainJs / budget.mainJs - 1, overGz = now.mainJsGzip / budget.mainJsGzip - 1;
      const note = `main JS ${(now.mainJs / 1000).toFixed(0)} kB (${over >= 0 ? '+' : ''}${(over * 100).toFixed(1)}% on the budget), gzip ${(now.mainJsGzip / 1000).toFixed(0)} kB (${overGz >= 0 ? '+' : ''}${(overGz * 100).toFixed(1)}%)`;
      return { ...r, ok: over <= budget.growth && overGz <= budget.growth, note: over > budget.growth || overGz > budget.growth ? `${note}: over the ${budget.growth * 100}% allowed; shrink it, or raise ${BUDGETS} in its own commit and say why` : note };
    } catch (e) { return { ...r, ok: false, note: `size check failed: ${e.message}` }; }
  }),
  step('tests', 'node', ['scripts/suite.mjs', '--tier', 'gate', '--fresh', '--dir', join(OUT, 'tests')]),
  step('lint', 'node', ['scripts/suite.mjs', '--lint']),
]);

let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  const last = r.note ?? (r.out.trim().split(/\r?\n/).filter((l) => l.trim()).pop() ?? '').slice(0, 140);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(10)} ${r.secs.toFixed(1).padStart(6)} s  ${last}`);
  if (!r.ok) console.log(r.out.trim().split(/\r?\n/).slice(-25).map((l) => `      ${l}`).join('\n') + `\n      (all of it: ${r.log})`);
}
console.log(bad ? `gate: ${bad} of ${results.length} steps failed` : 'gate: all four steps pass');
process.exit(bad ? 1 : 0);
