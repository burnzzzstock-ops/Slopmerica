// Browser slots: at most SLOTS headless browsers at once from this checkout, shared by every script and every helper that runs here.
// A slot is a lock file holding its owner's process id (made with the exclusive 'wx' flag, so two takers cannot both win). Waiters
// queue first come, first served through ticket files. A lock or a ticket whose process has gone is cleared by the next taker, so a
// killed test never leaves a slot taken. Works the same on Windows, Linux and macOS (it replaces scripts/withslot.sh, which needed flock).
//
//   import { takeSlot } from './lib/slots.mjs';  await takeSlot();   // held until this process exits (scripts/lib/browser.mjs does this)
//   node scripts/lib/slots.mjs <command> [args]                      // run any command inside a slot
//   node scripts/lib/slots.mjs --status                              // who holds what
// env: SLOTS (default 4), SLOT_DIR (default <checkout>/shots/tmp/slots, so each checkout has its own), SLOT_HELD=1 (the caller already has one)
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SLOT_DIR = process.env.SLOT_DIR || join(ROOT, 'shots', 'tmp', 'slots');
export const SLOTS = Math.max(1, Number(process.env.SLOTS || 4) | 0);

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pidIn = (file) => { try { return Number(readFileSync(file, 'utf8').trim()) || 0; } catch { return 0; } };
const rm = (file) => { try { unlinkSync(file); } catch { /* gone */ } };

/** Run fn while holding the folder's mutex (a directory: mkdir is atomic everywhere). Held for microseconds; one older than 10 s was left by a killed process. */
function locked(fn) {
  mkdirSync(SLOT_DIR, { recursive: true });
  const m = join(SLOT_DIR, 'mutex');
  for (;;) {
    try { mkdirSync(m); break; } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM') throw e;
      try { if (Date.now() - statSync(m).mtimeMs > 10000) rmdirSync(m); } catch { /* someone else cleared it */ }
      nap(5 + Math.random() * 20);
    }
  }
  try { return fn(); } finally { try { rmdirSync(m); } catch { /* */ } }
}

let mine = 0, ticket = null;
/** One try: slot number, or 0 when all are taken or someone is ahead in the queue. */
function tryTake() {
  return locked(() => {
    const tickets = readdirSync(SLOT_DIR).filter((f) => f.startsWith('wait-')).sort();
    for (const t of tickets) {
      if (t === ticket) break;                               // nobody alive ahead of me
      if (alive(Number(t.split('-')[2]))) return 0;          // somebody is: wait my turn
      rm(join(SLOT_DIR, t));
    }
    for (let n = 1; n <= SLOTS; n++) {
      const f = join(SLOT_DIR, `slot-${n}.lock`);
      if (existsSync(f)) { if (alive(pidIn(f))) continue; rm(f); }
      try { const fd = openSync(f, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd); } catch { continue; }
      if (ticket) { rm(join(SLOT_DIR, ticket)); ticket = null; }
      return n;
    }
    return 0;
  });
}

/** Give the slot back (also done when the process exits). */
export function releaseSlot() {
  if (ticket) { rm(join(SLOT_DIR, ticket)); ticket = null; }
  if (!mine) return;
  const f = join(SLOT_DIR, `slot-${mine}.lock`);
  if (pidIn(f) === process.pid) rm(f);
  mine = 0;
}

/** Take a slot for this process (once: a second call returns the same slot). Resolves to its number, 0 when the caller already holds one (SLOT_HELD). */
export async function takeSlot() {
  if (process.env.SLOT_HELD === '1' || mine) return mine;
  mkdirSync(SLOT_DIR, { recursive: true });
  process.on('exit', releaseSlot);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseSlot(); process.exit(130); });
  // the ticket sorts by time taken, then by process id
  ticket = `wait-${String(Date.now()).padStart(15, '0')}-${process.pid}`;
  closeSync(openSync(join(SLOT_DIR, ticket), 'w'));
  for (;;) {
    mine = tryTake();
    if (mine) break;
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
  }
  process.stderr.write(`[slot ${mine} acquired]\n`);   // scripts/suite.mjs starts a test's clock at this line
  return mine;
}

/** Who holds what, for --status and for tests. */
export function slotStatus() {
  mkdirSync(SLOT_DIR, { recursive: true });
  const held = [];
  for (let n = 1; n <= SLOTS; n++) { const pid = pidIn(join(SLOT_DIR, `slot-${n}.lock`)); held.push({ slot: n, pid, alive: alive(pid) }); }
  const waiting = readdirSync(SLOT_DIR).filter((f) => f.startsWith('wait-')).map((f) => Number(f.split('-')[2])).filter(alive);
  return { dir: SLOT_DIR, slots: SLOTS, held, waiting };
}

// ---- run as a command: node scripts/lib/slots.mjs <command> [args]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '--status') {
    const s = slotStatus();
    console.log(`${s.dir}: ${s.held.filter((h) => h.alive).length} of ${s.slots} slots held${s.waiting.length ? `, ${s.waiting.length} waiting` : ''}`);
    for (const h of s.held) console.log(`  slot ${h.slot}: ${h.alive ? `process ${h.pid}` : h.pid ? `free (process ${h.pid} is gone)` : 'free'}`);
    process.exit(0);
  }
  await takeSlot();
  const p = spawn(cmd === 'node' ? process.execPath : cmd, args, { stdio: 'inherit', env: { ...process.env, SLOT_HELD: '1' }, shell: cmd !== 'node' && process.platform === 'win32' });
  p.on('close', (code) => { releaseSlot(); process.exit(code ?? 1); });
  p.on('error', (e) => { console.error(String(e)); releaseSlot(); process.exit(127); });
}
