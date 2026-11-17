// Photo mode's controls. The look lane's PhotoMode (src/render/photo.ts) freezes the county, hides the HUD and gives the
// camera to a free lens; this is the one piece of the HUD left on screen while it is up: a row of buttons along the bottom
// (Done, Street level, the postcard frame, Save, Save 4K, Adjust) and, behind Adjust, the hour, the weather, the blur, the
// focus and the zoom. On a phone the row scrolls sideways and the sliders stay folded until asked for, so the picture is in view.
import { FOV_MAX, FOV_MIN, IS_TOUCH } from '../config';
import type { Game } from '../game';
import type { PhotoWeather } from '../render/photo';
import { uiIcon } from './icons';

const WEATHERS: [PhotoWeather | null, string][] = [[null, 'As it is'], ['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['fog', 'Fog']];
/** the focus slider runs from 2 m to 6.5 km; a step is the same share of the distance everywhere on it */
const NEAR = 2, FAR = 6500;
const toFocus = (v: number) => NEAR * (FAR / NEAR) ** (v / 100);
const fromFocus = (m: number) => (100 * Math.log(Math.max(NEAR, Math.min(FAR, m)) / NEAR)) / Math.log(FAR / NEAR);
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const clock = (h: number) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export class PhotoBar {
  readonly el: HTMLElement;
  /** the postcard frame ("Greetings from ...") is drawn on the saved picture */
  framed = true;
  private adjust = false;
  private busy = false;

  constructor(private game: Game, root: HTMLElement, private toast: (text: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'photo-bar';
    this.el.hidden = true;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Photo mode');
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-pb]') as HTMLElement | null;
      if (b) void this.act(b.dataset.pb!);
    });
    this.el.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement, p = this.game.photo, v = Number(i.value);
      if (i.dataset.pbr === 'hour') { p.hour = v; this.el.querySelector('[data-pbo="hour"]')!.textContent = clock(v); }
      else if (i.dataset.pbr === 'tilt') p.tilt = v;
      else if (i.dataset.pbr === 'focus') { p.focusDistance = toFocus(v); this.el.querySelector('[data-pbo="focus"]')!.textContent = metres(p.focusDistance); }
      else if (i.dataset.pbr === 'fov') p.fov = FOV_MIN + FOV_MAX - v;   // (the slider reads as zoom: right is closer)
    });
  }

  get open() { return !this.el.hidden; }

  /** Into photo mode: the county freezes and the HUD goes, but for this bar. */
  enter() {
    const p = this.game.photo;
    if (p.active) return;
    this.game.rts.follow(null);
    p.enter();
    this.adjust = false;
    this.render();
    this.el.hidden = false;
    // photo mode ends itself on Esc, and the HUD is not refreshed while it is up: watch for the end from here
    const watch = () => { if (!this.game.photo.active) this.el.hidden = true; else requestAnimationFrame(watch); };
    requestAnimationFrame(watch);
  }

  exit() {
    this.game.photo.exit();
    this.el.hidden = true;
  }

  private async act(what: string) {
    const p = this.game.photo;
    if (what === 'exit') this.exit();
    // (Street level moves the focus to 60 m: the Focus slider, when it is showing, has to say so)
    else if (what === 'street') { p.street(); if (this.adjust) this.render(); }
    else if (what === 'frame') { this.framed = !this.framed; this.render(); }
    else if (what === 'adjust') { this.adjust = !this.adjust; this.render(); }
    else if (what.startsWith('wx:')) { const w = what.slice(3); p.weather = w === 'none' ? null : (w as PhotoWeather); this.render(); }
    else if ((what === 'save' || what === 'save4k') && !this.busy) {
      this.busy = true;
      try {
        // (4K: the long side 3840, in the screen's own shape, so a phone held upright saves an upright picture)
        const cv = this.game.renderer.domElement, wide = cv.width >= cv.height, r = cv.width / Math.max(1, cv.height);
        const size = what === 'save4k' ? (wide ? { width: 3840, height: Math.min(2160, Math.round(3840 / r / 2) * 2) } : { width: Math.min(2160, Math.round(3840 * r / 2) * 2), height: 3840 }) : undefined;
        await p.download(this.framed, size);
        this.toast(`${this.framed ? 'Postcard' : 'Photo'} saved${size ? ` (${size.width} × ${size.height})` : ''}.`);
      } catch (err) {
        this.toast(`The photo could not be saved: ${err instanceof Error ? err.message : String(err)}`);
      } finally { this.busy = false; }
    }
  }

  private render() {
    const p = this.game.photo;
    const chip = (act: string, label: string, on = false, title = '') => `<button class="chip ${on ? 'on' : ''}" data-pb="${act}" ${title ? `title="${title}"` : ''} ${act === 'frame' || act === 'adjust' ? `aria-pressed="${on}"` : ''}>${label}</button>`;
    this.el.innerHTML = `
      ${this.adjust ? `<div class="pb-adjust">
        <label><span>Hour</span><input type="range" data-pbr="hour" min="0" max="24" step="0.25" value="${p.hour}" aria-label="Hour of day"><output data-pbo="hour">${clock(p.hour)}</output></label>
        <label><span>Blur</span><input type="range" data-pbr="tilt" min="0" max="1" step="0.05" value="${p.tilt}" aria-label="Tilt-shift blur"></label>
        <label><span>Focus</span><input type="range" data-pbr="focus" min="0" max="100" step="1" value="${Math.round(fromFocus(p.focusDistance))}" aria-label="Focus distance"><output data-pbo="focus">${metres(p.focusDistance)}</output></label>
        ${this.game.post.active ? '' : '<small class="pb-note">Blur and focus show on the Medium graphics preset and up (Settings).</small>'}
        <label><span>Zoom</span><input type="range" data-pbr="fov" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${FOV_MIN + FOV_MAX - p.fov}" aria-label="Zoom"></label>
        <div class="pb-row pb-wx" role="group" aria-label="Weather">${WEATHERS.map(([w, label]) => chip(`wx:${w ?? 'none'}`, label, p.weather === w)).join('')}</div>
      </div>` : ''}
      <div class="pb-row">
        ${chip('exit', `${uiIcon('action', 'done', '✓', 20)} Done`, false, 'Leave photo mode (Esc)')}
        ${chip('save', `${uiIcon('toolbar', 'photo', '📷', 20)} Save ${this.framed ? 'postcard' : 'photo'}`, true)}
        ${chip('save4k', '4K', false, 'Save at 3840 pixels on the long side')}
        ${chip('frame', '🖼️ Postcard frame', this.framed, 'Greetings from your county, printed on the picture')}
        ${chip('street', `${uiIcon('action', 'street', '🚶', 20)} Street level`, false, 'Stand in the street at the middle of the view')}
        ${chip('adjust', '🎚️ Adjust', this.adjust, 'Hour, weather, blur, focus and zoom')}
      </div>
      <small class="pb-hint">${IS_TOUCH ? 'Drag to look around · two fingers to move' : 'Drag to look · W A S D to move, Q E down and up, Shift faster · wheel to move in and out · Esc to leave'}</small>`;
  }
}
