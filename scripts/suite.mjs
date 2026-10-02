// The test suite runner: runs the test list in README.md against one running game, two at a time, with a timeout per test, writing each
// result to a summary file the moment it finishes, so a rerun after a container restart (or a Ctrl-C) skips what already finished.
// A README line `node scripts/x.mjs args   # what it checks` is a test unless SKIP below says why not (tools that take pictures, scripts
// that ask the Jev model and need a key); a new README line is therefore a new test without touching this file.
//
// usage: BASE_URL=http://127.0.0.1:5210 node scripts/suite.mjs [--dir shots/suite/<name>] [--only a,b] [--skip c] [--retry-failed] [--lint] [--list]
//   env: PAR=2 (tests at a time; each also takes a slot from scripts/withslot.sh, which is two across everybody), TIMEOUT=1800 (seconds, per test)
//   --dir     where the summary (summary.tsv) and one log per test go (default shots/suite/run); the same dir resumes, a new dir starts over
//   --retry-failed  run again the tests that failed or timed out in this dir (the passes stay)
//   --lint    do not run anything: check every README script exists, the browser ones honour BASE_URL, and list scripts missing from the README
//   --list    print what would run and what is skipped, and why
// Exits 1 when any test failed or timed out (skipped ones do not count).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? true); };
const flag = (name) => argv.includes(name);
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const dir = opt('--dir') || 'shots/suite/run';
const PAR = Number(process.env.PAR || 2);
const TIMEOUT = Number(process.env.TIMEOUT || 1800) * 1000;
const only = (opt('--only') || '').split(',').filter(Boolean), skipArg = (opt('--skip') || '').split(',').filter(Boolean);

// why a README script is not run as a test (name without .mjs)
const SKIP = {
  suite: 'this runner (its own README line: run from the suite it would start the suite again)',
  contentaudit: 'asks the Jev model: needs a key, run on purpose (content gate)',
  feedtags: 'asks the Jev model: needs a key', nametags: 'asks the Jev model: needs a key', learnability: 'asks the Jev model: needs a key',
  brandcheck: 'asks the Jev model: needs a key', triage: 'asks the Jev model: needs a key and a folder of reports',
  lineup: 'a capture tool, not a pass/fail test', carcam: 'a capture tool', sheet: 'a capture tool', snapshot: 'serves the game (tooling)',
  streetaudiofigure: 'draws a figure for a report', 'streetaudio-figure': 'draws a figure for a report', townshots: 'a capture tool', progression: 'a measurement, not pass/fail',
  'playtest6-late': 'a measuring tool (CHECK=1 makes it a gate)', nightwarmth: 'a measurement (MAX_CCT=K makes it a check)', towers: 'a measurement', towerlab: 'a measurement',
  lowperf: 'a measurement (two builds side by side)', peoplelineup: 'a capture tool (its `feet` mode is a check, run on purpose)', peoplecost: 'a measurement',
  peoplestats: 'a measurement', junctionplan: 'a capture tool', junctionshots: 'a capture tool', lookbook: 'a capture tool', vehiclestats: 'a table, not a test',
  aacompare: 'a measurement', trafficscale: 'a measurement over its target today (the traffic pass owns it)', audit8: 'a scripted play session that writes pictures',
  nightcost: 'a measurement (where a night frame goes)', nightlook: 'a measurement (MIN_TREE / MIN_CAR make it a check)',
  parkingtags: 'asks the Jev model: needs a key (its --dry-run needs none)', econtest: 'a measurement (CHECK=1 makes it a gate)', bldshots: 'a capture tool',
};
// tests that serve the game themselves (they build it and host it, so they take no BASE_URL)
const SELF_HOSTED = new Set(['savefallback']);
// env a test needs
const ENV = { 'streetaudio-game': { QUALITY: 'low' } };
// tests that legitimately take long (seconds)
const SLOW = { soak: 3600, yellowflash: 5400, nighttest: 2400, uisweep: 1800 };

// ---- the list: README lines `node scripts/<name>.mjs <args>   # <what>`
const readme = readFileSync('README.md', 'utf8').split('\n');
const tests = [];
for (const line of readme) {
  const m = line.match(/^node scripts\/([\w-]+)\.mjs((?: [^#]*?)?)\s*(?:#\s*(.*))?$/);
  if (!m) continue;
  const name = m[1], args = m[2].trim();
  const label = args && /^(phone|desk|desktop)$/.test(args) ? `${name}-${args}` : name;
  if (tests.some((t) => t.label === label)) continue;
  tests.push({ name, label, args, what: (m[3] || '').trim(), skip: SKIP[name] ?? null });
}

if (flag('--lint')) {
  let bad = 0;
  const say = (s) => { console.log(s); bad++; };
  for (const t of tests) {
    const f = `scripts/${t.name}.mjs`;
    if (!existsSync(f)) { say(`MISSING ${f} is in the README but not on disk`); continue; }
    const src = readFileSync(f, 'utf8');
    const browser = /chromium\.launch|openBlock\(/.test(src) && !t.skip;   // (a tool that takes pictures is not a test, and may take other arguments)
    if (browser && !SELF_HOSTED.has(t.name) && !/BASE_URL/.test(src)) say(`NO BASE_URL ${f} drives a browser but never reads BASE_URL`);
    if (!t.what) say(`NO DESCRIPTION ${f} has a README line without a "# what it checks"`);
  }
  const listed = new Set(tests.map((t) => t.name));
  const unlisted = readdirSync('scripts').filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).filter((n) => !listed.has(n));
  console.log(`scripts on disk but not in the README (${unlisted.length}): ${unlisted.join(' ')}`);
  console.log(bad ? `${bad} problem(s)` : 'README lines: every script exists, the browser ones honour BASE_URL, every line says what it checks');
  process.exit(bad ? 1 : 0);
}

const todo = tests.filter((t) => !t.skip && (!only.length || only.includes(t.label) || only.includes(t.name)) && !skipArg.includes(t.label) && !skipArg.includes(t.name));
if (flag('--list')) {
  for (const t of tests) console.log(`${t.skip ? 'skip' : 'test'}  ${t.label.padEnd(24)} ${t.skip ?? t.what.slice(0, 90)}`);
  console.log(`${tests.filter((t) => !t.skip).length} tests, ${tests.filter((t) => t.skip).length} skipped`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
const sumFile = join(dir, 'summary.tsv');
if (!existsSync(sumFile)) writeFileSync(sumFile, '');
const done = new Map();
for (const l of readFileSync(sumFile, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const [label, code, secs, status] = l.split('\t');
  done.set(label, { code: Number(code), secs: Number(secs), status });
}
const queue = todo.filter((t) => { const d = done.get(t.label); return !d || (flag('--retry-failed') && d.status !== 'PASS'); });
console.log(`suite on ${base}: ${todo.length} tests, ${todo.length - queue.length} already finished in ${dir}, ${queue.length} to run, ${PAR} at a time`);

const run = (t) => new Promise((resolve) => {
  const log = join(dir, `${t.label}.log`);
  const secsLimit = (SLOW[t.name] ?? 0) * 1000 || TIMEOUT;
  const env = { ...process.env, BASE_URL: base, ...(ENV[t.name] ?? {}) };
  // a test that opens no browser (the offline ones) does not wait for a browser slot
  const browser = SELF_HOSTED.has(t.name) || /chromium\.launch|openBlock\(/.test(readFileSync(`scripts/${t.name}.mjs`, 'utf8'));
  const cmd = [...(browser ? ['scripts/withslot.sh'] : []), 'node', `scripts/${t.name}.mjs`, ...(t.args ? t.args.split(/\s+/) : [])];
  writeFileSync(log, `$ ${cmd.join(' ')}\n`);
  const t0 = Date.now();
  const p = spawn(cmd[0], cmd.slice(1), { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (b) => appendFileSync(log, b);
  p.stdout.on('data', out); p.stderr.on('data', out);
  let timedOut = false, timer = null, t1 = t0;
  // the limit counts from the moment the test has its browser slot (scripts/withslot.sh says so on stderr), not from the wait for one
  const arm = () => { t1 = Date.now(); timer = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }, secsLimit); };
  if (!browser) arm();
  let armed = !browser;
  p.stderr.on('data', (b) => { if (!armed && /\[slot \d acquired\]/.test(String(b))) { armed = true; arm(); } });
  const waitCap = setTimeout(() => { if (!armed) { timedOut = true; try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } } }, 6 * 3600 * 1000);
  p.on('close', (code) => {
    clearTimeout(timer); clearTimeout(waitCap);
    const secs = Math.round((Date.now() - t1) / 1000);
    const status = timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
    appendFileSync(log, `\nexit ${code}${timedOut ? ' (timed out)' : ''} after ${secs} s\n`);
    appendFileSync(sumFile, `${t.label}\t${code ?? -1}\t${secs}\t${status}\n`);
    done.set(t.label, { code: code ?? -1, secs, status });
    console.log(`${status.padEnd(7)} ${t.label.padEnd(24)} ${secs} s`);
    resolve();
  });
});
const workers = Array.from({ length: PAR }, async () => { while (queue.length) await run(queue.shift()); });
await Promise.all(workers);

// ---- the table
const firstFail = (label) => {
  try {
    const lines = readFileSync(join(dir, `${label}.log`), 'utf8').split('\n');
    return (lines.find((l) => /^FAIL|✗|Error|TimeoutError/.test(l)) ?? '').slice(0, 110);
  } catch { return ''; }
};
console.log('\n| test | result | seconds | first failing line |\n| --- | --- | --- | --- |');
let fails = 0;
for (const t of tests) {
  if (t.skip) { if (!only.length) console.log(`| ${t.label} | SKIP | | ${t.skip} |`); continue; }
  if (!todo.includes(t)) continue;
  const d = done.get(t.label);
  if (!d) { console.log(`| ${t.label} | NOT RUN | | |`); fails++; continue; }
  if (d.status !== 'PASS') fails++;
  console.log(`| ${t.label} | ${d.status} | ${d.secs} | ${d.status === 'PASS' ? '' : firstFail(t.label)} |`);
}
console.log(`\n${todo.length - fails} of ${todo.length} pass${fails ? `, ${fails} do not (logs in ${dir})` : ''}`);
process.exit(fails ? 1 : 0);
