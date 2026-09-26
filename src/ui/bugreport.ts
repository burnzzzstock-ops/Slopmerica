// Playtest plumbing: remember recent errors and what the player was doing,
// and turn them into a bug report the tester copies, shares or saves and
// sends to whoever gave them the game. There is no server: nothing leaves
// the device unless the tester sends it.
import type { Game } from '../game';
import { IS_TOUCH } from '../config';
import { snapshot } from '../sim/save';

declare const __BUILD__: string;
/** Short build id (git commit + date), stamped at build time. */
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

type Err = { t: number; msg: string; where: string; n: number };
const errors: Err[] = [];
const crumbs: { t: number; s: string }[] = [];
const T0 = performance.now();
let errorListener: ((e: Err) => void) | null = null;

const clock = (t: number) => {
  const s = Math.max(0, Math.round((t - T0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Note something the player did (tool picked, panel opened, road built...). */
export function crumb(s: string) {
  const last = crumbs[crumbs.length - 1];
  if (last && last.s === s) { last.t = performance.now(); return; }
  crumbs.push({ t: performance.now(), s: s.slice(0, 120) });
  if (crumbs.length > 40) crumbs.shift();
}

const text = (x: unknown): string => {
  if (x instanceof Error) return x.message;
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x)?.slice(0, 200) ?? String(x); } catch { return String(x); }
};

function record(msg: string, stack?: string) {
  msg = (msg || 'Unknown error').slice(0, 300);
  const where = (stack ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.includes(msg.slice(0, 24))).slice(0, 3).join(' | ').slice(0, 400);
  const same = errors.find((e) => e.msg === msg && e.where === where);
  if (same) { same.n++; same.t = performance.now(); return; }
  const e: Err = { t: performance.now(), msg, where, n: 1 };
  errors.push(e);
  if (errors.length > 12) errors.shift();
  crumb(`ERROR ${msg.slice(0, 90)}`);
  errorListener?.(e);
}

/** Call first thing at startup: captures uncaught errors, rejections and console.error. */
export function installErrorCapture() {
  window.addEventListener('error', (e) => record(e.message || text(e.error), e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => record(text(e.reason), (e.reason as Error | undefined)?.stack));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record(args.map(text).join(' '), (args.find((a) => a instanceof Error) as Error | undefined)?.stack);
    original(...args);
  };
}

export function onCapturedError(fn: ((e: { msg: string }) => void) | null) {
  errorListener = fn;
}

export const errorCount = () => errors.length;

function gpu(g: Game | null): string {
  try {
    const gl = g?.renderer.getContext() ?? document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return `${name} · ${typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'}`;
  } catch {
    return 'unknown';
  }
}

function device(): string {
  const ua = navigator.userAgent;
  const ios = ua.match(/OS (\d+)[_.](\d+)/);
  const os = /iPhone|iPad|iPod/.test(ua) ? `iOS ${ios ? `${ios[1]}.${ios[2]}` : ''}`.trim()
    : /Android/.test(ua) ? `Android ${ua.match(/Android ([\d.]+)/)?.[1] ?? ''}`.trim()
    : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const inApp = /Claude/i.test(ua) ? ' (Claude app)' : '';
  return `${os} · ${br}${inApp} · ${window.innerWidth}×${window.innerHeight} @${(window.devicePixelRatio || 1).toFixed(1)}x · ${IS_TOUCH ? 'touch' : 'mouse'}`;
}

export type ReportFields = { kind: string; what: string; expected: string; withLog: boolean };

/** The plain-text report. `g` is null when the game never started. */
export function buildReport(g: Game | null, f: ReportFields, extra?: string): string {
  const L: string[] = [];
  L.push(`🐞 SLOPMERICA BUG REPORT · ${f.kind}`);
  L.push(`What happened: ${f.what.trim() || '(not filled in)'}`);
  if (f.expected.trim()) L.push(`Expected: ${f.expected.trim()}`);
  if (extra) L.push(extra);
  L.push('—');
  L.push(`Build: ${BUILD}`);
  L.push(`Device: ${device()}`);
  L.push(`GPU: ${gpu(g)}`);
  if (g) {
    const p = g.perf, s = g.sim;
    L.push(`Perf: ${p.fps.toFixed(0)} fps · ${p.frameMs.toFixed(0)} ms · ${p.quality} · ${Math.round(p.resolution * 100)}% res · ${p.calls} draws`);
    const money = s.money === Infinity ? '∞' : `$${Math.round(s.money).toLocaleString()}`;
    L.push(`City: ${g.cityName} (${g.map.def.id}, ${s.mode}) · day ${Math.floor(s.day)} · pop ${s.population.toLocaleString()} · ${money} · ${g.net.segs.size} roads · ${g.buildings.list.size} buildings`);
    const t = g.tools, c = g.rts.target;
    L.push(`Where: tool ${t.active}${t.extTool ? `/${t.extTool}` : ''} · camera ${Math.round(c.x)},${Math.round(c.z)} · zoom ${Math.round(g.rts.distance)} · speed ${s.speed}`);
    L.push(`Graphics: ${graphics(g)}`);
    const fs = g.prof.stats();
    if (fs.frames) L.push(`Frames (last ${fs.frames}): avg ${fs.avg.toFixed(1)} ms · p95 ${fs.p95.toFixed(1)} ms · worst ${fs.max.toFixed(0)} ms · usually ${g.prof.top(4).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
    if (g.prof.worst.length) {
      L.push('Slowest frames:');
      for (const w of g.prof.worst.slice(0, 3)) L.push(` ${w.ms.toFixed(0)} ms at ${clock(w.at)}: ${w.parts.map(([k, v]) => `${k} ${v}`).join(', ')} · ${w.ctx}`);
    }
    const dm = (['res', 'com', 'ind', 'off'] as const).map((k) => {
      const h = s.demandHistory[k], v = Math.round(s.demand[k]), tr = h.length > 1 ? Math.round(h[h.length - 1] - h[0]) : 0;
      return `${k[0].toUpperCase()} ${v > 0 ? '+' : ''}${v}${tr ? ` (${tr > 0 ? '+' : ''}${tr}/wk)` : ''}`;
    });
    L.push(`Demand: ${dm.join(' · ')}`);
    const hist = s.history.slice(-8);
    if (hist.length) L.push(`Timeline: ${hist.map((h) => `d${h.day} ${h.pop} pop ${s.money === Infinity ? '' : `$${Math.round(h.money / 1000)}k`}`.trim()).join(' → ')}`);
  }
  L.push(`Session: ${clock(performance.now())} played`);
  if (f.withLog) {
    if (errors.length) {
      L.push(`Errors (${errors.length}):`);
      for (const e of errors) L.push(` [${clock(e.t)}${e.n > 1 ? ` ×${e.n}` : ''}] ${e.msg}${e.where ? ` @ ${e.where}` : ''}`);
    } else L.push('Errors: none caught');
    if (crumbs.length) {
      L.push('Recent actions:');
      for (const c of crumbs.slice(-25)) L.push(` ${clock(c.t)} ${c.s}`);
    }
  }
  return L.join('\n');
}

/** quality preset, whether post effects run (and why not), and the drawing buffer */
function graphics(g: Game): string {
  try {
    const r = g.renderer, gl = r.getContext(), a = gl.getContextAttributes();
    const fx = g.post.active ? 'effects on' : g.post.offReason ? `effects OFF (${g.post.offReason})` : 'effects off (preset)';
    return `${g.q.name}${g.pendingQuality ? ` → ${g.pendingQuality} on reload` : ''} · ${fx} · ${gl.drawingBufferWidth}×${gl.drawingBufferHeight} px · pixel ratio ${r.getPixelRatio().toFixed(2)} · ${a?.antialias ? 'MSAA' : 'no MSAA'}${gl.isContextLost() ? ' · CONTEXT LOST' : ''}`;
  } catch {
    return 'unknown';
  }
}

type Downloads = { save(r: { filename: string; data: string | Blob }): Promise<{ status: string }> };
type ClaudeWindow = { claude?: { use?: (n: string) => Promise<unknown> } };

/** Save a text/JSON file: the viewer's download capability inside Claude, a plain download elsewhere. */
export async function saveFile(filename: string, data: string): Promise<'saved' | 'declined' | 'failed'> {
  const use = (window as unknown as ClaudeWindow).claude?.use;
  if (use) {
    try {
      const dl = (await use('downloads')) as Downloads | null;
      if (dl) {
        await dl.save({ filename, data: new Blob([data], { type: 'text/plain' }) });
        return 'saved';
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
    }
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

async function copyText(s: string, fallback: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    fallback.value = s;
    fallback.focus();
    fallback.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'city';

const KINDS = ['Broken', 'Looks wrong', 'Confusing', 'Slow', 'Idea'];

/**
 * The report sheet. `g` null = the game failed to start (boot rescue).
 * `prefill` seeds "what happened" (e.g. the error that just popped).
 */
export function openBugReport(parent: HTMLElement, g: Game | null, opts: { prefill?: string; kind?: string; extra?: string; onClose?: () => void } = {}) {
  document.querySelector('.bug')?.remove();
  const el = document.createElement('div');
  el.className = 'bug';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Report a bug');
  let kind = opts.kind ?? 'Broken';
  el.innerHTML = `
    <div class="bug-sheet">
      <div class="bug-head"><b>🐞 Report a bug</b><button class="bug-x" aria-label="Close">✕</button></div>
      <p class="bug-lede">Thanks for testing! Describe it in your own words; the game adds the technical details.</p>
      <div class="bug-kinds">${KINDS.map((k) => `<button class="chip ${k === kind ? 'on' : ''}" data-kind="${k}">${k}</button>`).join('')}</div>
      <label class="bug-field"><span>What happened?</span><textarea id="bug-what" rows="3" placeholder="e.g. I tapped Build and the road disappeared">${esc(opts.prefill ?? '')}</textarea></label>
      <label class="bug-field"><span>What did you expect? <em>optional</em></span><input id="bug-exp" placeholder="e.g. a road" /></label>
      <label class="bug-chk"><input type="checkbox" id="bug-log" checked /> Include my recent actions and any errors</label>
      <div class="bug-actions">
        <button class="bug-primary" id="bug-copy">📋 Copy report</button>
        ${typeof navigator.share === 'function' ? '<button id="bug-share">📤 Share…</button>' : ''}
        <button id="bug-file">💾 Save as file</button>
        ${g ? '<button id="bug-city">🏙️ Save city file</button>' : ''}
      </div>
      <div class="bug-status" aria-live="polite"></div>
      <details class="bug-peek"><summary>See exactly what's in the report</summary><textarea id="bug-preview" rows="9" readonly></textarea></details>
      <small class="bug-fine">Nothing is sent automatically. Paste or attach the report in a message to whoever sent you the game. A city file lets them load your exact town.</small>
    </div>`;
  parent.appendChild(el);
  crumb('opened bug report');
  const $ = <T extends HTMLElement>(q: string) => el.querySelector(q) as T;
  const what = $<HTMLTextAreaElement>('#bug-what'), exp = $<HTMLInputElement>('#bug-exp'), log = $<HTMLInputElement>('#bug-log');
  const preview = $<HTMLTextAreaElement>('#bug-preview'), status = $<HTMLElement>('.bug-status');
  const report = () => buildReport(g, { kind, what: what.value, expected: exp.value, withLog: log.checked }, opts.extra);
  const refresh = () => { preview.value = report(); };
  const say = (msg: string, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };
  refresh();
  el.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind!;
    el.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    refresh();
  }));
  for (const inp of [what, exp, log]) inp.addEventListener('input', refresh);
  // Esc closes the sheet wherever focus is (phones never focus inside it)
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && el.isConnected) { e.stopPropagation(); close(); } };
  const close = () => { document.removeEventListener('keydown', onKey, true); el.remove(); opts.onClose?.(); };
  document.addEventListener('keydown', onKey, true);
  $('.bug-x').addEventListener('click', close);
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  const nudge = () => { if (!what.value.trim()) { what.focus(); say('Add a few words about what happened first.', true); return false; } return true; };
  $('#bug-copy').addEventListener('click', async () => {
    if (!nudge()) return;
    const ok = await copyText(report(), preview);
    if (ok) say('Copied. Paste it in a message to whoever sent you the game.');
    else {
      (el.querySelector('.bug-peek') as HTMLDetailsElement).open = true;
      preview.focus();
      preview.select();
      say("Couldn't copy automatically: the report is selected below, copy it from there.", true);
    }
  });
  el.querySelector('#bug-share')?.addEventListener('click', async () => {
    if (!nudge()) return;
    try {
      await navigator.share({ title: 'Slopmerica bug report', text: report() });
      say('Shared. Thank you!');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') say('Sharing is blocked here. Use Copy report or Save as file instead.', true);
    }
  });
  $('#bug-file').addEventListener('click', async () => {
    if (!nudge()) return;
    const r = await saveFile(`slopmerica-bug-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, report());
    say(r === 'saved' ? 'Saved. Attach the file in a message to whoever sent you the game.' : r === 'declined' ? 'Not saved.' : 'Saving files is blocked here. Use Copy report instead.', r === 'failed');
  });
  el.querySelector('#bug-city')?.addEventListener('click', async () => {
    if (!g) return;
    const r = await saveFile(`slopmerica-${slug(g.cityName)}-day${Math.floor(g.sim.day)}.json`, JSON.stringify(snapshot(g)));
    say(r === 'saved' ? 'City file saved. Attach it along with the report.' : r === 'declined' ? 'Not saved.' : 'Saving files is blocked here.', r === 'failed');
  });
  setTimeout(() => { if (!IS_TOUCH) what.focus(); }, 50);
  return close;
}

/**
 * The game failed to start (bad save, no WebGL, a crash while loading):
 * say so plainly and give the tester a way out instead of a frozen
 * loading screen.
 */
export function showBootFailure(parent: HTMLElement, err: unknown, opts: { restoring: boolean; savedJSON: string | null; shelveSave: () => void }) {
  const msg = text(err);
  record(msg, (err as Error | undefined)?.stack);
  const noGL = /webgl|context/i.test(msg);
  const el = document.createElement('div');
  el.className = 'boot-fail';
  el.innerHTML = `
    <div class="bf-card">
      <div class="bf-kicker">Road closed</div>
      <h2>Slopmerica couldn't start</h2>
      <p>${noGL ? "This browser couldn't start 3D graphics (WebGL). Try another browser, turn off low-power mode, or update your device."
        : opts.restoring ? 'Something in your saved city tripped it up. That is a bug, not you.' : 'Something broke while loading. That is a bug, not you.'}</p>
      <code>${esc(msg.slice(0, 220))}</code>
      <div class="bf-actions">
        <button class="bug-primary" id="bf-report">🐞 Report this</button>
        <button id="bf-retry">↻ Try again</button>
        ${opts.restoring ? '<button id="bf-fresh">🆕 Start a new city</button>' : ''}
        ${opts.restoring && opts.savedJSON ? '<button id="bf-city">💾 Save the city file</button>' : ''}
      </div>
      ${opts.restoring ? '<small>Starting a new city sets the old one aside (it is kept in this browser, not deleted) so the developer can still fix it.</small>' : ''}
      <small class="bf-build">Build ${esc(BUILD)}</small>
    </div>`;
  parent.appendChild(el);
  el.querySelector('#bf-report')!.addEventListener('click', () => openBugReport(parent, null, { kind: 'Broken', prefill: `The game wouldn't start${opts.restoring ? ' when I tapped Resume trip' : ''}.`, extra: `Boot failure: ${msg.slice(0, 300)}` }));
  el.querySelector('#bf-retry')!.addEventListener('click', () => location.reload());
  el.querySelector('#bf-fresh')?.addEventListener('click', () => { opts.shelveSave(); location.hash = ''; location.reload(); });
  el.querySelector('#bf-city')?.addEventListener('click', () => { if (opts.savedJSON) void saveFile('slopmerica-broken-city.json', opts.savedJSON); });
}

/** The GPU dropped the WebGL context: nothing renders until a reload. */
export function showContextLost(parent: HTMLElement, saved: boolean, onReport: () => void) {
  if (parent.querySelector('.ctx-lost')) return;
  const el = document.createElement('div');
  el.className = 'ctx-lost';
  el.innerHTML = `<b>The graphics crashed.</b> <span>${saved ? 'Your city was saved. Reload to keep playing.' : "Saving failed (storage full or blocked), so a reload may lose recent changes. Report it to save a city file first."}</span>
    <button class="bug-primary" id="cl-reload">↻ Reload</button><button id="cl-report">🐞 Report</button>`;
  parent.appendChild(el);
  el.querySelector('#cl-reload')!.addEventListener('click', () => location.reload());
  el.querySelector('#cl-report')!.addEventListener('click', onReport);
}
