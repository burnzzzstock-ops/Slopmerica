// Title screen: a cinematic main menu over key art rendered in the game's own
// engine, a New City screen (county, rules, name), and the loading screen.
import { MAPS, MapId } from '../world/maps';
import type { Mode } from '../sim/sim';
import { MERCH_URL } from '../art/brands';
import { loadSave, type SaveData } from '../sim/save';
import { BUILD } from './bugreport';
import { IS_TOUCH } from '../config';
import heroArt from '../art/keyart/hero.webp';
import appalachiaArt from '../art/keyart/appalachia.webp';
import norcalArt from '../art/keyart/norcal.webp';
import floridaArt from '../art/keyart/florida.webp';

export interface StartChoice {
  map: MapId;
  mode: Mode;
  cityName: string;
  restore?: SaveData;
  /** restore came from a loaded file, not this browser's save */
  imported?: boolean;
}

/** A city file someone saved from the bug report sheet (or a backup). */
function parseCityFile(text: string): SaveData | string {
  let d: SaveData;
  try { d = JSON.parse(text); } catch { return "That file isn't a Slopmerica city (not JSON)."; }
  if (!d || typeof d !== 'object' || d.v !== 1) return "That file isn't a Slopmerica city file.";
  if (!MAPS.some((m) => m.id === d.map)) return 'That city is on a county this build does not have.';
  if (!d.roads || !d.zones || !Array.isArray(d.buildings) || !Array.isArray(d.communes)) return 'That city file is incomplete.';
  return d;
}

const MODES: { id: Mode; name: string; blurb: string }[] = [
  { id: 'ponzi', name: 'Growth Ponzi', blurb: 'The real game. New roads are cheap today and expensive forever.' },
  { id: 'sandbox', name: 'Unlimited Slop', blurb: 'Infinite money, everything unlocked. Pure vibes.' },
  { id: 'hippie', name: 'Hippie Hell', blurb: 'Twice the communes, and way more of them never leave.' },
  { id: 'speedrun', name: 'Speedrun to Delhi', blurb: 'Double growth, $150K. How fast can you pave it all?' },
];

const TIPS = [
  'Reticulating stroads…', 'Paving paradise…', 'Putting up a parking lot…', 'Asking Grok if this is true…', 'Adding one more lane…',
  'Zoning the wetlands “Luxury”…', 'Negotiating with the drum circle…', 'Loading 4,000 Dollar Colonels…', 'Community Noting the trees…',
  'Getting in the cannon…', 'Filling ’er up…', 'Summoning Florida Man…', 'Calculating induced demand…',
];

const CITY_NAMES: Record<MapId, string[]> = {
  appalachia: ['Holler County', 'Slopington', 'Possum Trot', 'New Wheeling', 'Coalburg'],
  norcal: ['Golden Slop', 'San Slopcisco', 'Malibu Heights', 'Redwood Commons'],
  florida: ['Gator Gulch', 'Port Slop Lucie', 'Florida Mantown', 'Sawgrass Springs'],
};

const COUNTY_ART: Record<MapId, string> = { appalachia: appalachiaArt, norcal: norcalArt, florida: floridaArt };

export function slopLogoHTML(sub = 'merica') {
  return `<div class="logo"><span class="logo-slop">Slop<svg class="swoosh" viewBox="0 0 220 40" aria-hidden="true"><path d="M4 30 C 60 38, 120 34, 214 6 C 150 26, 90 34, 30 30 Z"/></svg></span><span class="logo-merica">${sub}</span></div>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function showTitle(parent: HTMLElement): Promise<StartChoice> {
  return new Promise((resolve) => {
    const saved = loadSave();
    let map: MapId = 'appalachia';
    let mode: Mode = 'ponzi';
    const county = (id: MapId) => MAPS.find((m) => m.id === id);
    const el = document.createElement('div');
    el.className = 'title aaa';
    el.innerHTML = `
      <div class="aaa-art" aria-hidden="true"><img src="${heroArt}" alt="" decoding="async" /></div>
      <div class="aaa-scrim" aria-hidden="true"></div>
      <section class="aaa-home">
        <div class="aaa-brand">
          ${slopLogoHTML()}
          <div class="aaa-tag">Land of the Free Parking</div>
        </div>
        <nav class="aaa-nav">
          ${saved ? `<button class="aaa-btn is-primary" id="continue">
            <span class="aaa-btn-label">Resume trip</span>
            <span class="aaa-btn-sub">${esc(saved.city)} · ${esc(county(saved.map)?.name ?? saved.map)} · pop ${(saved.pop ?? 0).toLocaleString()} · ${ago(saved.savedAt)}</span>
          </button>` : ''}
          <button class="aaa-btn ${saved ? '' : 'is-primary'}" id="new">
            <span class="aaa-btn-label">New city</span>
            <span class="aaa-btn-sub">Pick a county. Pave it.</span>
          </button>
          <div class="aaa-links">
            <button class="aaa-link" id="import">Load a city file</button>
            <a class="aaa-link" href="${MERCH_URL}" target="_blank" rel="noopener">Real Slop merch ↗</a>
          </div>
          <input type="file" id="import-file" accept=".json,application/json" hidden />
          <div class="aaa-import-msg" role="status" hidden></div>
        </nav>
      </section>
      <section class="aaa-setup" hidden>
        <div class="aaa-panel">
          <header class="aaa-setup-head">
            <button class="aaa-back" id="back" aria-label="Back">←</button>
            <h2>New city</h2>
          </header>
          <div class="aaa-step">
            <h3>County</h3>
            <div class="aaa-maps">${MAPS.map((m) => `
              <button class="aaa-map ${m.id === map ? 'on' : ''}" data-map="${m.id}" aria-pressed="${m.id === map}">
                <img src="${COUNTY_ART[m.id]}" alt="" decoding="async" />
                <span class="aaa-map-body"><b>${m.name}</b><small>${m.place}</small><em>${m.blurb}</em></span>
              </button>`).join('')}</div>
          </div>
          <div class="aaa-step">
            <h3>Rules</h3>
            <div class="aaa-modes" role="radiogroup">${MODES.map((m) => `
              <button class="aaa-mode ${m.id === mode ? 'on' : ''}" data-mode="${m.id}" role="radio" aria-checked="${m.id === mode}">
                <b>${m.name}</b><small>${m.blurb}</small>
              </button>`).join('')}</div>
          </div>
          <div class="aaa-step aaa-go-row">
            <label class="aaa-name"><span>Town name</span><input id="cityname" maxlength="28" value="${CITY_NAMES[map][0]}" /></label>
            <button class="aaa-go" id="go">Start paving</button>
          </div>
        </div>
      </section>
      <footer class="aaa-foot">
        <span class="aaa-badge">Playtest</span>
        <span>Things will break. Tap <b>🐞 Report bug</b> in the game${IS_TOUCH ? ' (under More)' : ''}.</span>
        <span class="aaa-build">Build ${esc(BUILD)}</span>
      </footer>`;
    parent.appendChild(el);
    const img = el.querySelector('.aaa-art img') as HTMLImageElement;
    const ready = () => el.classList.add('art-ready');
    if (img.complete) ready(); else img.addEventListener('load', ready, { once: true });

    const home = el.querySelector('.aaa-home') as HTMLElement, setup = el.querySelector('.aaa-setup') as HTMLElement;
    const show = (s: 'home' | 'setup') => {
      home.hidden = s !== 'home';
      setup.hidden = s !== 'setup';
      el.classList.toggle('is-setup', s === 'setup');
      (s === 'setup' ? (el.querySelector('.aaa-map.on') as HTMLElement) : (el.querySelector('.aaa-btn') as HTMLElement))?.focus({ preventScroll: true });
    };
    el.querySelector('#new')!.addEventListener('click', () => show('setup'));
    el.querySelector('#back')!.addEventListener('click', () => show('home'));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !setup.hidden) show('home'); });

    const name = el.querySelector('#cityname') as HTMLInputElement;
    let edited = false;
    name.addEventListener('input', () => (edited = true));
    el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => b.addEventListener('click', () => {
      map = b.dataset.map as MapId;
      el.querySelectorAll<HTMLElement>('.aaa-map').forEach((x) => { const on = x.dataset.map === map; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      if (!edited) name.value = CITY_NAMES[map][Math.floor(Math.random() * CITY_NAMES[map].length)];
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode as Mode;
      el.querySelectorAll<HTMLElement>('.aaa-mode').forEach((x) => { const on = x.dataset.mode === mode; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    }));
    const leave = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    };
    el.querySelector('#continue')?.addEventListener('click', () => {
      leave();
      resolve({ map: saved!.map, mode: saved!.mode, cityName: saved!.city, restore: saved! });
    });
    // load a city file: validated first; this browser's own save is only
    // replaced once the loaded city is running and autosaves
    const file = el.querySelector('#import-file') as HTMLInputElement, msg = el.querySelector('.aaa-import-msg') as HTMLElement;
    el.querySelector('#import')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const d = parseCityFile(await f.text());
      file.value = '';
      if (typeof d === 'string') { msg.textContent = d; msg.hidden = false; return; }
      leave();
      resolve({ map: d.map, mode: d.mode, cityName: d.city, restore: d, imported: true });
    });
    el.querySelector('#go')!.addEventListener('click', () => {
      leave();
      resolve({ map, mode, cityName: name.value.trim() || CITY_NAMES[map][0] });
    });
  });
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function showLoading(parent: HTMLElement): { done: () => void } {
  const el = document.createElement('div');
  el.className = 'loading aaa';
  el.innerHTML = `
    <div class="aaa-art" aria-hidden="true"><img src="${heroArt}" alt="" /></div>
    <div class="aaa-scrim is-dim" aria-hidden="true"></div>
    <div class="aaa-loading">
      ${slopLogoHTML()}
      <div class="aaa-progress"><span></span></div>
      <div class="load-tip" id="load-tip">${TIPS[0]}</div>
    </div>`;
  parent.appendChild(el);
  el.classList.add('art-ready');
  const iv = setInterval(() => {
    (el.querySelector('#load-tip') as HTMLElement).textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }, 900);
  return {
    done: () => {
      clearInterval(iv);
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    },
  };
}
