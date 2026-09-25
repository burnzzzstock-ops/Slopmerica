// Title screen: map pick, mode pick, city name, and the loading screen.
import { MAPS, MapId } from '../world/maps';
import type { Mode } from '../sim/sim';
import { MERCH_URL } from '../art/brands';
import { loadSave, type SaveData } from '../sim/save';

export interface StartChoice {
  map: MapId;
  mode: Mode;
  cityName: string;
  restore?: SaveData;
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

function paintCard(c: HTMLCanvasElement, id: MapId) {
  const ctx = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const rnd = mulberry(id.length * 97);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  const skyCols: Record<MapId, [string, string]> = { appalachia: ['#f7b86b', '#8fb3d9'], norcal: ['#ffd9a0', '#7ec2ea'], florida: ['#ffe3b0', '#5cc9f0'] };
  sky.addColorStop(0, skyCols[id][1]);
  sky.addColorStop(1, skyCols[id][0]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const ridge = (y: number, amp: number, freq: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, y - Math.abs(Math.sin(x * freq + y)) * amp - Math.sin(x * freq * 2.7) * amp * 0.3);
    ctx.lineTo(W, H);
    ctx.fill();
  };
  const dots = (y0: number, y1: number, cols: string[], n: number, r: number) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.beginPath();
      ctx.arc(rnd() * W, y0 + rnd() * (y1 - y0), r * (0.6 + rnd() * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  if (id === 'appalachia') {
    ridge(H * 0.42, 30, 0.012, '#6f7f8f');
    ridge(H * 0.55, 34, 0.018, '#56713d');
    dots(H * 0.45, H * 0.8, ['#d08a2a', '#c2542a', '#e0b23a', '#4f7d2e', '#6f9038'], 260, 6);
    ctx.fillStyle = '#4f7a78';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.85);
    ctx.bezierCurveTo(W * 0.3, H * 0.7, W * 0.6, H * 1.0, W, H * 0.8);
    ctx.lineTo(W, H * 0.9);
    ctx.bezierCurveTo(W * 0.6, H * 1.1, W * 0.3, H * 0.8, 0, H * 0.95);
    ctx.fill();
  } else if (id === 'norcal') {
    ctx.fillStyle = '#1f6fa8';
    ctx.fillRect(0, H * 0.5, W, H * 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(W * 0.42, 0, W, H);
    ctx.clip();
    ridge(H * 0.5, 40, 0.01, '#2d4a2d');
    ctx.restore();
    ctx.fillStyle = '#c9a85a';
    ctx.beginPath();
    ctx.moveTo(W * 0.25, H);
    for (let x = W * 0.25; x <= W; x += 4) ctx.lineTo(x, H * 0.62 - Math.sin(x * 0.02) * 16);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.fillStyle = '#e9dcb4';
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H);
    ctx.quadraticCurveTo(W * 0.2, H * 0.72, W * 0.32, H * 0.66);
    ctx.lineTo(W * 0.36, H);
    ctx.fill();
    for (let i = 0; i < 16; i++) {
      const x = W * 0.62 + rnd() * W * 0.38, y = H * 0.36 + rnd() * 40;
      ctx.fillStyle = '#244a2a';
      ctx.beginPath();
      ctx.moveTo(x, y - 34);
      ctx.lineTo(x - 7, y + 10);
      ctx.lineTo(x + 7, y + 10);
      ctx.fill();
    }
    dots(H * 0.66, H * 0.95, ['#55703a', '#6a8440'], 40, 6);
  } else {
    const sea = ctx.createLinearGradient(0, H * 0.55, 0, H);
    sea.addColorStop(0, '#136f9a');
    sea.addColorStop(1, '#44d4d0');
    ctx.fillStyle = sea;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.fillStyle = '#7c8c45';
    ctx.fillRect(0, H * 0.48, W, H * 0.12);
    ctx.fillStyle = '#f3ecd6';
    ctx.fillRect(0, H * 0.6, W, 6);
    dots(H * 0.46, H * 0.56, ['#4a6a32', '#5d7a3a'], 70, 5);
    for (let i = 0; i < 6; i++) {
      const x = rnd() * W, y = H * 0.5;
      ctx.strokeStyle = '#8a6a4a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + 6);
      ctx.quadraticCurveTo(x + 6, y - 14, x + 4, y - 30);
      ctx.stroke();
      ctx.fillStyle = '#4f8a32';
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.ellipse(x + 4 + Math.cos(k * 1.3) * 9, y - 30 + Math.sin(k * 1.3) * 4, 10, 3, k * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slopLogoHTML(sub = 'merica') {
  return `<div class="logo"><span class="logo-slop">Slop<svg class="swoosh" viewBox="0 0 220 40" aria-hidden="true"><path d="M4 30 C 60 38, 120 34, 214 6 C 150 26, 90 34, 30 30 Z"/></svg></span><span class="logo-merica">${sub}</span></div>`;
}

// ------------------------------------------------------------------ cover art
// The title is styled as a 1970s gas-station road map: cream folded paper,
// four print inks, halftone, and a hand-painted sunset highway.
const INK = { paper: '#efe3c4', navy: '#1f2b45', red: '#c23a24', mustard: '#e3a42c', teal: '#2e7b77', orange: '#e2763a', brown: '#5b4436' };

/** Paper fibers + speckle, generated once and tiled as a CSS background. */
let paperURL = '';
function paperTexture(): string {
  if (paperURL) return paperURL;
  const c = document.createElement('canvas');
  c.width = c.height = 220;
  const x = c.getContext('2d')!;
  x.fillStyle = INK.paper;
  x.fillRect(0, 0, 220, 220);
  const r = mulberry(1977);
  for (let i = 0; i < 2600; i++) {
    const v = r();
    x.fillStyle = v < 0.5 ? `rgba(120,90,50,${0.04 + r() * 0.06})` : `rgba(255,250,235,${0.05 + r() * 0.08})`;
    x.fillRect(r() * 220, r() * 220, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  x.strokeStyle = 'rgba(110,80,40,0.06)';
  for (let i = 0; i < 70; i++) {
    const px = r() * 220, py = r() * 220, a = r() * Math.PI;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * (6 + r() * 14), py + Math.sin(a) * (6 + r() * 14));
    x.stroke();
  }
  paperURL = c.toDataURL();
  return paperURL;
}

/** The cover illustration: sunset over the road out of town. */
function paintHero(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(320, c.clientWidth), H = Math.max(200, c.clientHeight);
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const x = c.getContext('2d')!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = mulberry(69);
  const hz = H * 0.62; // horizon
  // banded retro sky
  const bands = ['#2c5d6b', '#3f7474', '#c9803c', '#e39a3a', '#eeb659', '#f3cf87'];
  for (let i = 0; i < bands.length; i++) {
    x.fillStyle = bands[i];
    x.fillRect(0, (hz * i) / bands.length, W, hz / bands.length + 1);
  }
  // sun with cut lines
  const sx = W * 0.64, sr = Math.min(W, H) * 0.2;
  x.save();
  x.beginPath();
  x.arc(sx, hz, sr, Math.PI, 0);
  x.clip();
  x.fillStyle = '#f8e4ac';
  x.fillRect(sx - sr, hz - sr, sr * 2, sr);
  x.fillStyle = bands[4];
  for (let k = 0; k < 5; k++) x.fillRect(sx - sr, hz - sr * 0.12 - k * sr * 0.14, sr * 2, sr * 0.035 * (1 + k * 0.3));
  x.restore();
  // mesas / hills
  const ridge = (base: number, amp: number, f: number, col: string, seed: number) => {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, hz + 2);
    for (let px = 0; px <= W; px += 6) {
      const h = Math.max(0, Math.sin(px * f + seed) * 0.6 + Math.sin(px * f * 2.3 + seed * 2) * 0.4);
      x.lineTo(px, base - h * amp);
    }
    x.lineTo(W, hz + 2);
    x.fill();
  };
  ridge(hz, H * 0.12, 0.006, '#a45a3a', 1);
  ridge(hz, H * 0.07, 0.011, '#7c4634', 4);
  // ground
  const g = x.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#c9a765');
  g.addColorStop(1, '#a8834a');
  x.fillStyle = g;
  x.fillRect(0, hz, W, H - hz);
  // furrows converge on the vanishing point
  const vx = W * 0.42;
  x.strokeStyle = 'rgba(90,60,30,0.18)';
  x.lineWidth = 1;
  for (let i = -24; i <= 24; i++) {
    x.beginPath();
    x.moveTo(vx, hz);
    x.lineTo(vx + i * W * 0.09, H);
    x.stroke();
  }
  // strip of town on the horizon: stores, a water tower, a big sign
  x.fillStyle = INK.brown;
  let tx = W * 0.05;
  while (tx < W * 0.34) {
    const bw = 14 + r() * 34, bh = 6 + r() * 16;
    x.fillRect(tx, hz - bh, bw, bh);
    tx += bw + 2 + r() * 6;
  }
  const wtx = W * 0.8;
  x.fillRect(wtx - 1.5, hz - 44, 3, 44);
  x.fillRect(wtx - 11, hz - 44, 2, 30);
  x.fillRect(wtx + 9, hz - 44, 2, 30);
  x.beginPath();
  x.ellipse(wtx, hz - 50, 16, 11, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = INK.paper;
  x.font = `900 7px 'Overpass', sans-serif`;
  x.textAlign = 'center';
  x.fillText('SLOPMERICA', wtx, hz - 48);
  // highway into the sunset
  x.fillStyle = '#34302e';
  x.beginPath();
  x.moveTo(vx - 2, hz);
  x.lineTo(vx + 2, hz);
  x.lineTo(W * 0.78, H);
  x.lineTo(W * 0.06, H);
  x.closePath();
  x.fill();
  // shoulders + dashed center line
  x.strokeStyle = '#efe3c4';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(vx - 1.5, hz); x.lineTo(W * 0.075, H); x.stroke();
  x.beginPath(); x.moveTo(vx + 1.5, hz); x.lineTo(W * 0.765, H); x.stroke();
  x.fillStyle = INK.mustard;
  for (let k = 0; k < 14; k++) {
    const t0 = Math.pow(k / 14, 2.2), t1 = Math.pow((k + 0.5) / 14, 2.2);
    const y0 = hz + (H - hz) * t0, y1 = hz + (H - hz) * t1;
    const cx0 = vx + (W * 0.42 - vx) * t0, cx1 = vx + (W * 0.42 - vx) * t1;
    const w0 = 0.5 + t0 * 7, w1 = 0.5 + t1 * 7;
    x.beginPath();
    x.moveTo(cx0 - w0 / 2, y0); x.lineTo(cx0 + w0 / 2, y0); x.lineTo(cx1 + w1 / 2, y1); x.lineTo(cx1 - w1 / 2, y1);
    x.fill();
  }
  // telephone poles and sagging wires down the right side
  x.strokeStyle = INK.navy;
  x.fillStyle = INK.navy;
  let prev: [number, number, number] | null = null;
  for (let k = 0; k < 9; k++) {
    const t = Math.pow(k / 8, 1.8);
    const px = vx + 8 + (W * 0.96 - vx) * t, py = hz + (H * 1.02 - hz) * t;
    const ph = 8 + t * H * 0.55, pw = 1 + t * 5;
    x.fillRect(px - pw / 2, py - ph, pw, ph);
    x.fillRect(px - ph * 0.12, py - ph * 0.94, ph * 0.24, Math.max(1, pw * 0.6));
    if (prev) {
      x.lineWidth = Math.max(0.6, t * 1.6);
      for (const side of [-1, 1]) {
        x.beginPath();
        x.moveTo(prev[0] + side * prev[2] * 0.1, prev[1]);
        x.quadraticCurveTo((prev[0] + px) / 2, (prev[1] + py - ph * 0.92) / 2 + 6 + t * 18, px + side * ph * 0.1, py - ph * 0.92);
        x.stroke();
      }
    }
    prev = [px, py - ph * 0.92, ph];
  }
  // the billboard: on wide heroes the title owns the whole sky on the left, so
  // the sign stands in the foreground field below the horizon instead
  const wide = W / H > 1.6;
  const bw = wide ? Math.min(W * 0.2, H - hz) : Math.min(W * 0.26, 300), bh = bw * 0.42;
  const bx = wide ? W * 0.035 : W * 0.2;
  const by = wide ? hz + (H - hz) * 0.08 + bh : hz + (H - hz) * 0.05;
  x.fillStyle = INK.navy;
  x.fillRect(bx + bw * 0.18, by - 2, 5, H);
  x.fillRect(bx + bw * 0.78, by - 2, 5, H);
  x.fillStyle = '#f5ead0';
  x.fillRect(bx, by - bh, bw, bh);
  x.strokeStyle = INK.navy;
  x.lineWidth = 3;
  x.strokeRect(bx, by - bh, bw, bh);
  x.fillStyle = INK.red;
  x.fillRect(bx + 4, by - bh + 4, bw - 8, bh * 0.2);
  x.fillStyle = '#f5ead0';
  x.font = `${Math.round(bh * 0.14)}px 'Anton', Impact, sans-serif`;
  x.textAlign = 'center';
  x.fillText('NEXT EXIT · 69 MI', bx + bw / 2, by - bh + 4 + bh * 0.16);
  x.fillStyle = INK.navy;
  x.font = `${Math.round(bh * 0.5)}px 'Yellowtail', cursive`;
  x.fillText('Slop', bx + bw / 2, by - bh * 0.22);
  x.font = `800 ${Math.round(bh * 0.11)}px 'Overpass', sans-serif`;
  x.fillText('GET IN THE CANNON', bx + bw / 2, by - bh * 0.06);
  // birds
  x.strokeStyle = INK.navy;
  x.lineWidth = 1.4;
  for (let i = 0; i < 5; i++) {
    const px = W * (0.5 + r() * 0.35), py = H * (0.12 + r() * 0.2), s = 4 + r() * 4;
    x.beginPath();
    x.moveTo(px - s, py);
    x.quadraticCurveTo(px - s / 2, py - s * 0.6, px, py);
    x.quadraticCurveTo(px + s / 2, py - s * 0.6, px + s, py);
    x.stroke();
  }
}

const SHIELD = `<svg class="rm-shield" viewBox="0 0 100 104" aria-hidden="true">
  <path d="M8 6 Q50 -4 92 6 Q100 50 50 100 Q0 50 8 6Z" fill="#f5ead0"/>
  <path d="M12 10 Q50 1 88 10 L88 30 L12 30Z" fill="#c23a24"/>
  <path d="M12 34 L88 34 Q92 58 50 94 Q8 58 12 34Z" fill="#1f2b45"/>
  <text x="50" y="25" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="13" fill="#f5ead0" letter-spacing="1">SLOPMERICA</text>
  <text x="50" y="76" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="38" fill="#f5ead0">69</text>
</svg>`;
const ROUNDEL = `<div class="rm-roundel" aria-hidden="true"><span class="rm-r-top">Official</span><span class="rm-r-slop">Slop</span><span class="rm-r-bot">Service</span></div>`;
const CIRCLE = `<svg class="rm-circle" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M52 5 C82 3 98 15 97 30 C96 48 74 57 47 56 C21 55 3 45 4 29 C5 14 25 5 60 7"/></svg>`;
const CHECK = `<svg class="rm-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13 C6 15 8 18 9 21 C12 13 16 7 22 2"/></svg>`;

export function showTitle(parent: HTMLElement): Promise<StartChoice> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'title rm';
    el.style.setProperty('--paper', `url(${paperTexture()})`);
    const saved = loadSave();
    let map: MapId = 'appalachia';
    let mode: Mode = 'ponzi';
    el.innerHTML = `
      <div class="rm-sheet">
        <header class="rm-top"><span>Official Road Map</span><i>★</i><span>2026 Edition</span><em>Free at participating Slop stations</em></header>
        <div class="rm-hero">
          <canvas class="rm-art"></canvas>
          ${SHIELD}
          ${ROUNDEL}
          <div class="rm-title">
            <div class="rm-kicker">The Official Road Map of</div>
            ${slopLogoHTML()}
            <div class="tagline rm-tag">Land of the Free Parking</div>
          </div>
        </div>
        ${saved ? `<button class="rm-ticket" id="continue"><span class="rm-t-lbl">Resume trip</span><b>${saved.city}</b><small>${MAPS.find((m) => m.id === saved.map)?.name ?? saved.map} · pop ${saved.pop.toLocaleString()} · saved ${ago(saved.savedAt)}</small></button>` : ''}
        <section class="rm-sec">
          <h2><i>1</i>${saved ? 'Or pick a new county' : 'Pick your county'}</h2>
          <div class="rm-maps">${MAPS.map((m) => `
            <button class="rm-map ${m.id === map ? 'on' : ''}" data-map="${m.id}">
              <canvas width="320" height="150"></canvas>
              <div class="rm-mbody"><b>${m.name}</b><small>${m.place}</small><p>${m.blurb}</p><em>“${m.tagline}”</em></div>
              ${CIRCLE}
            </button>`).join('')}</div>
        </section>
        <section class="rm-sec">
          <h2><i>2</i>How do you want to ruin it?</h2>
          <div class="rm-modes">${MODES.map((m) => `<button class="rm-mode ${m.id === mode ? 'on' : ''}" data-mode="${m.id}"><span class="rm-box">${CHECK}</span><span><b>${m.name}</b><small>${m.blurb}</small></span></button>`).join('')}</div>
        </section>
        <section class="rm-sec rm-start">
          <h2><i>3</i>Name your town</h2>
          <div class="rm-row">
            <input id="cityname" class="rm-name" maxlength="28" value="${CITY_NAMES[map][0]}" aria-label="City name" />
            <button class="rm-go" id="go">Start paving <span>➜</span></button>
          </div>
        </section>
        <footer class="rm-fine">Not responsible for sprawl, induced demand or Florida Man. Slop is a real clothing brand: <a href="${MERCH_URL}" target="_blank" rel="noopener">imaginesupply.co</a></footer>
      </div>`;
    parent.appendChild(el);
    const art = el.querySelector('.rm-art') as HTMLCanvasElement;
    const paint = () => paintHero(art);
    paint();
    // repaint once the sign fonts land, and on resize
    document.fonts?.ready.then(paint).catch(() => {});
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    el.querySelectorAll<HTMLButtonElement>('.rm-map').forEach((b) => paintCard(b.querySelector('canvas')!, b.dataset.map as MapId));
    const name = el.querySelector('#cityname') as HTMLInputElement;
    let edited = false;
    name.addEventListener('input', () => (edited = true));
    el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => b.addEventListener('click', () => {
      map = b.dataset.map as MapId;
      el.querySelectorAll('.rm-map').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.map === map));
      if (!edited) name.value = CITY_NAMES[map][Math.floor(Math.random() * CITY_NAMES[map].length)];
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode as Mode;
      el.querySelectorAll('.rm-mode').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === mode));
    }));
    const leave = () => {
      window.removeEventListener('resize', onResize);
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    };
    el.querySelector('#continue')?.addEventListener('click', () => {
      leave();
      resolve({ map: saved!.map, mode: saved!.mode, cityName: saved!.city, restore: saved! });
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
  el.className = 'loading rm';
  el.style.setProperty('--paper', `url(${paperTexture()})`);
  el.innerHTML = `<div class="rm-kicker">Unfolding the map of</div>${slopLogoHTML()}<div class="load-tip" id="load-tip">${TIPS[0]}</div><div class="load-bar rm-road"><span></span></div>`;
  parent.appendChild(el);
  let i = 0;
  const iv = setInterval(() => {
    i = (i + 1) % TIPS.length;
    (el.querySelector('#load-tip') as HTMLElement).textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }, 700);
  return {
    done: () => {
      clearInterval(iv);
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    },
  };
}
