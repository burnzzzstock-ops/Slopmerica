// The test suite runner. The tests are listed in scripts/tests/*.json (one file per owner, so two people adding tests never edit the
// same file); this runs them against one running game, several at a time, with a timeout per test, writing each result to a summary
// file the moment it finishes, so a rerun after a crash (or a Ctrl-C) skips what already finished.
//
// usage: node scripts/suite.mjs [--tier gate|smoke|full] [--serve [port]] [--dir shots/suite/<name>] [--only a,b] [--skip c] [--owner fable]
//                               [--gpu] [--fresh] [--retry-failed] [--with-key] [--lint] [--list]
//   --tier    gate: the checks that need no browser (seconds; before every commit). smoke: the quick browser checks (before every push).
//             full (the default): every pass/fail test, gate and smoke included. Entries of tier "measure" (measurements, capture tools,
//             scripts that ask a paid model) never run unless named with --only.
//   --serve   serve a frozen copy of this checkout for the run (scripts/snapshot.mjs) on the port given (default 5189) and stop it after;
//             without it the tests go to BASE_URL (default http://127.0.0.1:5173)
//   --gpu     draw with the real graphics card (GPU=1 for scripts/lib/browser.mjs) in every test that does not measure pixels: live frames come
//             at the screen's rate, not under 1 a second, so the browser tests finish sooner and run the way a player's game does. A test
//             marked "pixels": true always draws with SwiftShader, whatever is asked: its numbers must be the same on every machine.
//   --dir     where the summary (summary.tsv) and one log per test go (default shots/suite/<tier>); the same dir resumes, --fresh starts over
//   --retry-failed  run again the tests that failed or timed out in this dir (the passes stay)
//   --lint    run nothing: check the registry against the scripts on disk (see lint() below)
//   --list    print what would run and what would not, and why
//   env: PAR (tests at a time, default SLOTS; a browser test also takes a slot from scripts/lib/slots.mjs, SLOTS=4 across this checkout),
//        TIMEOUT (seconds, for tests that give none)
// Exits 1 when any test failed or timed out, and when nothing was selected (a run of 0 tests is a broken run, not a pass).
//
// A registry entry: { name, command, tier, timeout (s), needsBrowser, needsKey, env, what [, pixels, selfHosted, why, note] }
//   command      `node scripts/<file>.mjs <args>`, run from the checkout's root
//   pixels       it reads pixels back or depends on frame cost: always software WebGL
//   selfHosted   it builds and serves the game itself, so it takes no BASE_URL
//   why          for tier "measure": why it is not a pass/fail test
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { killTree, start } from './lib/proc.mjs';
import { SLOTS } from './lib/slots.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const flag = (name) => argv.includes(name);
const TIERS = ['gate', 'smoke', 'full', 'measure'];
const tier = opt('--tier') || 'full';
if (!['gate', 'smoke', 'full'].includes(tier)) { console.error(`suite: --tier is gate, smoke or full (got ${tier})`); process.exit(1); }
const dir = opt('--dir') || `shots/suite/${tier}`;
const PAR = Number(process.env.PAR || SLOTS);
const TIMEOUT = Number(process.env.TIMEOUT || 1800);
const list = (name) => String(opt(name) === true ? '' : opt(name) || '').split(',').filter(Boolean);
const only = list('--only'), skipArg = list('--skip'), owner = opt('--owner');
const gpu = flag('--gpu') || process.env.GPU === '1';

// What every test in one registry file runs with unless its own entry says otherwise.
// astra.json: the look lane's numbers, budgets and thresholds were recorded on the reference town as it was before it got its
// main street and utilities, so its tests open that town (REFTOWN=v1, scripts/lib/fixtures.mjs) until they are measured again.
// A test moves to today's town with "env": {"REFTOWN": "new"} in its entry; when all have moved, this line goes.
const LANE_ENV = { astra: { REFTOWN: 'v1' } };
// a script that opens a browser (it launches one itself, or opens the reference block, which does)
const BROWSER = /\blaunch\(|openBlock\(/;
const REG = 'scripts/tests';

// ---- the registry
const tests = [];
for (const f of existsSync(REG) ? readdirSync(REG).filter((f) => f.endsWith('.json')).sort() : []) {
  let rows;
  try { rows = JSON.parse(readFileSync(join(REG, f), 'utf8')); } catch (e) { console.error(`suite: ${REG}/${f} is not valid JSON: ${e.message}`); process.exit(1); }
  for (const t of rows) tests.push({ ...t, owner: f.slice(0, -5), script: (String(t.command).match(/^node (\S+\.mjs)/) || [])[1] ?? null });
}
if (!tests.length) { console.error(`suite: no tests found in ${REG}/*.json`); process.exit(1); }

if (flag('--lint')) process.exit(lint());
// a misspelled name must not quietly select nothing (or quietly skip nothing)
const unknown = [...only, ...skipArg].filter((n) => !tests.some((t) => t.name === n));
if (unknown.length) { console.error(`suite: no test named ${unknown.join(', ')} (node scripts/suite.mjs --list shows the names)`); process.exit(1); }
if (owner && !tests.some((t) => t.owner === owner)) { console.error(`suite: no registry file ${REG}/${owner}.json`); process.exit(1); }

// why a test is not in this run (null: it runs)
const left = (t) => {
  if (only.length) return only.includes(t.name) ? null : 'not named in --only';
  if (skipArg.includes(t.name)) return 'named in --skip';
  if (owner && t.owner !== owner) return `owner is ${t.owner}`;
  if (t.tier === 'measure') return t.why || 'a measurement or a tool, not a pass/fail test';
  if (t.needsKey && !flag('--with-key')) return 'needs a key (--with-key)';
  if (tier !== 'full' && t.tier !== tier) return `tier ${t.tier}`;
  return null;
};
const todo = tests.filter((t) => !left(t));
if (flag('--list')) {
  for (const t of tests) { const w = left(t); console.log(`${w ? 'skip' : 'test'}  ${t.tier.padEnd(7)} ${t.owner.padEnd(6)} ${t.name.padEnd(24)} ${w ?? String(t.what).slice(0, 90)}`); }
  console.log(`${todo.length} to run, ${tests.length - todo.length} not (${TIERS.map((k) => `${tests.filter((t) => t.tier === k).length} ${k}`).join(', ')})`);
  process.exit(0);
}
if (!todo.length) { console.error('suite: nothing selected (0 tests is a broken run, not a pass)'); process.exit(1); }

// ---- the game the tests drive
let base = process.env.BASE_URL || 'http://127.0.0.1:5173', server = null;
const stopServer = () => { if (server) { killTree(server); server = null; } };
if (flag('--serve') && todo.some((t) => t.needsBrowser && !t.selfHosted)) {
  const port = Number(opt('--serve') === true ? process.env.PORT || 5189 : opt('--serve'));
  server = start('node', ['scripts/snapshot.mjs', `suite-${port}`, String(port)]);
  process.on('exit', stopServer);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
  base = await new Promise((resolve, reject) => {
    let out = '';
    const on = (b) => { out += b; const m = out.match(/ready (http:\S+)/); if (m) resolve(m[1]); };
    server.stdout.on('data', on); server.stderr.on('data', on);
    server.on('close', (code) => reject(new Error(`the snapshot server stopped (exit ${code}) before it was ready:\n${out.slice(-2000)}`)));
    setTimeout(() => reject(new Error(`the snapshot server was not ready in 180 s:\n${out.slice(-2000)}`)), 180000);
  }).catch((e) => { console.error(`suite: ${e.message}`); stopServer(); process.exit(1); });
}

// ---- run
if (flag('--fresh')) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const sumFile = join(dir, 'summary.tsv');
if (!existsSync(sumFile)) writeFileSync(sumFile, '');
const done = new Map();
for (const l of readFileSync(sumFile, 'utf8').split(/\r?\n/)) {
  if (!l.trim()) continue;
  const [name, code, secs, status] = l.split('\t');
  done.set(name, { code: Number(code), secs: Number(secs), status });
}
const queue = todo.filter((t) => { const d = done.get(t.name); return !d || (flag('--retry-failed') && d.status !== 'PASS'); });
console.log(`suite (${tier}${gpu ? ', real GPU except pixel tests' : ''}) on ${base}: ${todo.length} tests, ${todo.length - queue.length} already finished in ${dir}, ${queue.length} to run, ${PAR} at a time`);

const run = (t) => new Promise((resolve) => {
  const log = join(dir, `${t.name}.log`);
  const limit = (t.timeout || TIMEOUT) * 1000;
  const env = { ...process.env, BASE_URL: base, GPU: gpu && !t.pixels ? '1' : '', ...(LANE_ENV[t.owner] ?? {}), ...(t.env ?? {}) };
  const cmd = t.command.split(/\s+/).filter((a) => !/^[<[]/.test(a));   // (a placeholder argument like <folder> is not passed)
  writeFileSync(log, `$ ${cmd.join(' ')}\n`);
  const t0 = Date.now();
  const p = start(cmd[0], cmd.slice(1), { env });
  const out = (b) => appendFileSync(log, b);
  p.stdout.on('data', out); p.stderr.on('data', out);
  let timedOut = false, timer = null, t1 = t0;
  // the limit counts from the moment the test has its browser slot (scripts/lib/browser.mjs's launch() says so on stderr), not from the wait for one
  const arm = () => { t1 = Date.now(); timer = setTimeout(() => { timedOut = true; killTree(p); }, limit); };
  let armed = !t.needsBrowser;
  if (armed) arm();
  p.stderr.on('data', (b) => { if (!armed && /\[slot \d+ acquired\]/.test(String(b))) { armed = true; arm(); } });
  const waitCap = setTimeout(() => { if (!armed) { timedOut = true; killTree(p); } }, 6 * 3600 * 1000);
  p.on('error', (e) => appendFileSync(log, `\ncould not start: ${e.message}\n`));
  p.on('close', (code) => {
    clearTimeout(timer); clearTimeout(waitCap);
    const secs = Math.round((Date.now() - t1) / 1000);
    const status = timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
    appendFileSync(log, `\nexit ${code}${timedOut ? ' (timed out)' : ''} after ${secs} s\n`);
    appendFileSync(sumFile, `${t.name}\t${code ?? -1}\t${secs}\t${status}\n`);
    done.set(t.name, { code: code ?? -1, secs, status });
    console.log(`${status.padEnd(7)} ${t.name.padEnd(24)} ${secs} s`);
    resolve();
  });
});
const t0 = Date.now();
await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length) await run(queue.shift()); }));
stopServer();

// ---- the table
const firstFail = (name) => {
  try {
    const lines = readFileSync(join(dir, `${name}.log`), 'utf8').split(/\r?\n/);
    return (lines.find((l) => /^FAIL|✗|Error|TimeoutError/.test(l)) ?? '').slice(0, 110);
  } catch { return ''; }
};
console.log('\n| test | result | seconds | first failing line |\n| --- | --- | --- | --- |');
let fails = 0;
for (const t of todo) {
  const d = done.get(t.name);
  if (!d) { console.log(`| ${t.name} | NOT RUN | | |`); fails++; continue; }
  if (d.status !== 'PASS') fails++;
  console.log(`| ${t.name} | ${d.status} | ${d.secs} | ${d.status === 'PASS' ? '' : firstFail(t.name)} |`);
}
console.log(`\n${todo.length - fails} of ${todo.length} pass${fails ? `, ${fails} do not (logs in ${dir})` : ''} (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fails ? 1 : 0);

// ---- --lint: the registry against what is on disk. Returns the exit code.
function lint() {
  let bad = 0;
  const say = (s) => { console.log(s); bad++; };
  const names = new Set(), listed = new Set();
  for (const t of tests) {
    const at = `${REG}/${t.owner}.json "${t.name}"`;
    if (!t.name || names.has(t.name)) say(`NAME ${at}: a name is missing or used twice`);
    names.add(t.name);
    for (const k of ['command', 'tier', 'what']) if (typeof t[k] !== 'string' || !t[k]) say(`FIELD ${at}: no ${k}`);
    for (const k of ['needsBrowser', 'needsKey']) if (typeof t[k] !== 'boolean') say(`FIELD ${at}: ${k} must be true or false`);
    if (!TIERS.includes(t.tier)) say(`TIER ${at}: ${t.tier} is not one of ${TIERS.join(', ')}`);
    if (!(t.timeout > 0)) say(`FIELD ${at}: timeout (seconds) must be a number`);
    if (!t.script) { say(`COMMAND ${at}: the command must be "node scripts/<file>.mjs ..."`); continue; }
    listed.add(t.script);
    if (!existsSync(t.script)) { say(`MISSING ${at}: ${t.script} is not on disk`); continue; }
    const src = readFileSync(t.script, 'utf8');
    const drives = BROWSER.test(src);
    if (drives !== t.needsBrowser && !t.selfHosted) say(`BROWSER ${at}: needsBrowser is ${t.needsBrowser} but ${t.script} ${drives ? 'opens' : 'never opens'} a browser`);
    if (t.tier === 'gate' && (t.needsBrowser || t.needsKey)) say(`TIER ${at}: a gate test may need neither a browser nor a key`);
    if (drives && t.tier !== 'measure' && !t.selfHosted && !/BASE_URL/.test(src)) say(`NO BASE_URL ${at}: ${t.script} drives a browser but never reads BASE_URL`);
  }
  // every script at the top of scripts/ is in the registry: as a test, or as a measure entry that says why it is not one
  const unlisted = readdirSync('scripts').filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`).filter((f) => !listed.has(f));
  for (const f of unlisted) say(`UNLISTED ${f} is in no ${REG}/*.json (add it: a test, or tier "measure" with a "why")`);
  // one browser launcher: nothing but scripts/lib/browser.mjs names a browser path or starts one itself
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mjs') ? [join(d, e.name).replace(/\\/g, '/')] : []));
  for (const f of walk('scripts')) {
    if (f === 'scripts/lib/browser.mjs' || f === 'scripts/suite.mjs') continue;
    const src = readFileSync(f, 'utf8');
    if (/pw-browsers|chromium\.launch\(/.test(src)) say(`LAUNCHER ${f} starts or names a browser itself: use launch() from scripts/lib/browser.mjs`);
  }
  console.log(bad ? `${bad} problem(s)` : `registry: ${tests.length} entries (${TIERS.map((k) => `${tests.filter((t) => t.tier === k).length} ${k}`).join(', ')}); every script is listed and exists, browser tests honour BASE_URL, one browser launcher`);
  return bad ? 1 : 0;
}
