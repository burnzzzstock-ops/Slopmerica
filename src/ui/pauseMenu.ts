// The pause menu: Esc with nothing else open (hud.ts). The game waits while it is up, and goes on at the speed it had.
// Resume, Save, Settings, Quit to title. Loaded when first opened, so it costs the main script nothing: for that it
// imports types only, and the HUD hands it everything it does (an import of the save code from here made the bundler cut
// 800 kB of the simulation out of the main script into a file of its own).
import type { Game } from '../game';

export interface PauseMenuHost {
  /** save the city in this browser; false when the browser would not store it */
  save(): boolean;
  /** a line for a bug report's recent actions */
  crumb(s: string): void;
  /** open the Settings drawer (the menu has closed by then) */
  settings(): void;
  /** leave for the title screen (the city has been saved, or the player has been told it could not be and pressed again) */
  quit(): void;
  /** the menu has gone, by any way out */
  closed(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openPauseMenu(parent: HTMLElement, g: Game, host: PauseMenuHost): { close(): void } {
  const speed = g.sim.speed;
  g.sim.speed = 0;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement('div');
  el.className = 'pause';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'pm-title');
  el.innerHTML = `
    <div class="pm-sheet">
      <h2 id="pm-title">Paused</h2>
      <p class="pm-city">${esc(g.cityName)} · ${esc(g.sim.dateLabel())}</p>
      <button class="pm-primary" data-pm="resume">Resume</button>
      <button data-pm="save">Save</button>
      <button data-pm="settings">Settings</button>
      <button data-pm="quit">Quit to title</button>
      <div class="pm-status" role="status"></div>
    </div>`;
  parent.appendChild(el);
  host.crumb('opened the pause menu');
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const status = el.querySelector('.pm-status') as HTMLElement;
  const say = (msg: string, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    g.sim.speed = speed;
    if (before?.isConnected) before.focus({ preventScroll: true });
    host.closed();
  };
  // every key belongs to the menu while it is up: the game's own shortcuts (B, Z, 1 2 3, Space) stay out of it
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) return;
    e.stopPropagation();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = (i: number) => { e.preventDefault(); buttons[(i + buttons.length) % buttons.length].focus(); };
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') to(at < 0 ? 0 : at + (e.shiftKey ? -1 : 1));
    else if (e.key === 'ArrowDown') to(at < 0 ? 0 : at + 1);
    else if (e.key === 'ArrowUp') to(at < 0 ? buttons.length - 1 : at - 1);
    else if (e.key === ' ' && at < 0) e.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  // outside the sheet is Resume, as on the bug report
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });

  // Quit leaves for the title screen. The city is saved first; if this browser will not store it, the first press says so
  // and the second leaves anyway.
  let warned = false;
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-pm]')?.dataset.pm;
    if (act === 'resume') close();
    else if (act === 'save') { const ok = host.save(); host.crumb(`pause menu: save ${ok ? 'ok' : 'failed'}`); say(ok ? 'Saved.' : 'Could not save in this browser', !ok); }
    else if (act === 'settings') { close(); host.settings(); }
    else if (act === 'quit') {
      const ok = host.save();
      if (!ok && !warned) { warned = true; say('Could not save in this browser. Press again to leave without saving.', true); return; }
      host.crumb(`pause menu: quit${ok ? '' : ' (not saved)'}`);
      host.quit();
    }
  });
  buttons[0].focus({ preventScroll: true });
  return { close };
}
