// Drive Mode (GAME_DESIGN.md §5.12) and Then and Now (§5.11), from the start of the game: their keys (V and N) and their two
// buttons on a car's, a road's and a building's card. Everything else about them is in src/tools/driveModeImpl.ts, which is
// loaded the first time one of those is used, so a player who never drives does not download it and it is not in the main
// script. The key or the button that asked for it is not lost: when the script has arrived, what it asked for is done.
//
// Nothing here touches the game when the file is loaded: it registers a system and the card buttons, as before.
import { DEBUG } from '../core/flags';
import { registerInspector, registerSystem } from '../ext/registry';
import type { Game, Selection } from '../game';
import type { DriveModeController, ThenAndNowViewer } from './driveModeImpl';

let controller: DriveModeController | null = null;
let thenNow: ThenAndNowViewer | null = null;
let loading: Promise<void> | null = null;

/** Bring the rest in (once). Its two objects install their own keys and clicks, which take over from the ones below. */
function load(g: Game): Promise<void> {
  return (loading ??= import('./driveModeImpl').then((m) => {
    thenNow = new m.ThenAndNowViewer(g);
    controller = new m.DriveModeController(g, thenNow);
  }));
}

registerSystem({
  id: 'driveMode',
  init(g: Game) {
    const typing = (e: Event) => { const t = (e.target as HTMLElement | null)?.tagName; return t === 'INPUT' || t === 'TEXTAREA'; };
    // V drives and N opens Then and Now, as they do once the script is in (where its own listeners have them)
    window.addEventListener('keydown', (e) => {
      if (controller || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'v' && k !== 'n') return;
      e.preventDefault();
      if (k === 'v') e.stopPropagation();
      void load(g).then(() => {
        if (k === 'n') { if (thenNow!.active) thenNow!.close(); else thenNow!.open(); }
        else if (controller!.active) controller!.exit();
        else controller!.enter();
      });
    }, { capture: true });
    // the two buttons on a card
    window.addEventListener('click', (e) => {
      if (controller) return;
      const t = e.target as HTMLElement | null;
      const drive = t?.closest?.('[data-drive-car]') as HTMLElement | null, then = t?.closest?.('[data-then-now]');
      if (!drive && !then) return;
      const id = drive ? Number(drive.getAttribute('data-drive-car')) : NaN;
      void load(g).then(() => { if (drive) controller!.enter(Number.isFinite(id) && id > 0 ? id : undefined); else thenNow!.open(); });
    });
    // Debug hooks, like the game's others: a player's build has none of them (src/core/flags.ts decides). They are there from
    // the start, as they were when the whole of Drive Mode was; what they stand for arrives with the script. Until then
    // `active` is false and `carId` is null, and a method called on one brings the script in and then calls it (the answer is a
    // promise that first time).
    if (DEBUG) {
      const hook = (get: () => object | null, idle: Record<string, unknown>) => new Proxy({}, {
        get: (_target, key) => {
          const o = get() as Record<string | symbol, unknown> | null;
          if (o) { const v = o[key]; return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : v; }
          if (typeof key !== 'string' || key === 'then') return undefined;
          if (key in idle) return idle[key];
          return (...args: unknown[]) => load(g).then(() => (get() as Record<string, (...a: unknown[]) => unknown>)[key]?.(...args));
        },
      });
      const win = window as unknown as { __drive?: unknown; __thenNow?: unknown };
      win.__drive = hook(() => controller, { active: false, carId: null });
      win.__thenNow = hook(() => thenNow, { active: false, split: 0.5 });
    }
  },
  frame(_g: Game, dt: number) {
    controller?.update(dt);
  },
});

registerInspector((sel: NonNullable<Selection>) => {
  if (sel.kind === 'car') {
    return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="act" data-drive-car="${sel.c.id}" style="flex:1;background:#c6f432;color:#111111;font-weight:800;border-radius:8px;padding:8px 12px;cursor:pointer">🛻 Drive Vehicle<span class="kbd-hint"> (V)</span></button><button type="button" class="act" data-then-now="1" style="background:#27272a;color:#efe6cf;font-weight:700;border-radius:8px;padding:8px 10px;cursor:pointer">📷 Then &amp; Now<span class="kbd-hint"> (N)</span></button></div>`;
  }
  if (sel.kind === 'road' || sel.kind === 'building') {
    return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="act" data-drive-car="0" style="flex:1;background:#27272a;color:#c6f432;border:1px solid #c6f432;font-weight:800;border-radius:8px;padding:7px 10px;cursor:pointer">🛻 Drive Stroad<span class="kbd-hint"> (V)</span></button><button type="button" class="act" data-then-now="1" style="background:#27272a;color:#efe6cf;font-weight:700;border-radius:8px;padding:7px 10px;cursor:pointer">📷 Then &amp; Now<span class="kbd-hint"> (N)</span></button></div>`;
  }
  return null;
});
