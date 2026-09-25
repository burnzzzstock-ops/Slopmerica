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

export function showTitle(parent: HTMLElement): Promise<StartChoice> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'title';
    const saved = loadSave();
    let map: MapId = 'appalachia';
    let mode: Mode = 'ponzi';
    el.innerHTML = `
      <div class="title-inner">
        ${slopLogoHTML()}
        <div class="tagline">Land of the Free Parking</div>
        ${saved ? `<button class="continue" id="continue"><b>Continue ${saved.city}</b><small>${MAPS.find((m) => m.id === saved.map)?.name ?? saved.map} · pop ${saved.pop.toLocaleString()} · saved ${ago(saved.savedAt)}</small></button>` : ''}
        <h2 class="title-h">${saved ? 'Or start a new city' : 'Pick your paradise'}</h2>
        <div class="maps">${MAPS.map((m) => `
          <button class="mapcard ${m.id === map ? 'on' : ''}" data-map="${m.id}">
            <canvas width="320" height="150"></canvas>
            <div class="mc-body"><b>${m.name}</b><small>${m.place}</small><p>${m.blurb}</p><em>“${m.tagline}”</em></div>
          </button>`).join('')}</div>
        <h2 class="title-h">How do you want to ruin it?</h2>
        <div class="modes">${MODES.map((m) => `<button class="modecard ${m.id === mode ? 'on' : ''}" data-mode="${m.id}"><b>${m.name}</b><small>${m.blurb}</small></button>`).join('')}</div>
        <div class="title-row">
          <label for="cityname">City name</label>
          <input id="cityname" maxlength="28" value="${CITY_NAMES[map][0]}" />
          <button class="go" id="go">Start paving</button>
        </div>
        <div class="title-foot">Slop is a real clothing brand. <a href="${MERCH_URL}" target="_blank" rel="noopener">Shop it at imaginesupply.co</a></div>
      </div>`;
    parent.appendChild(el);
    el.querySelectorAll<HTMLButtonElement>('.mapcard').forEach((b) => paintCard(b.querySelector('canvas')!, b.dataset.map as MapId));
    const name = el.querySelector('#cityname') as HTMLInputElement;
    let edited = false;
    name.addEventListener('input', () => (edited = true));
    el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => b.addEventListener('click', () => {
      map = b.dataset.map as MapId;
      el.querySelectorAll('.mapcard').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.map === map));
      if (!edited) name.value = CITY_NAMES[map][Math.floor(Math.random() * CITY_NAMES[map].length)];
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode as Mode;
      el.querySelectorAll('.modecard').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === mode));
    }));
    el.querySelector('#continue')?.addEventListener('click', () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
      resolve({ map: saved!.map, mode: saved!.mode, cityName: saved!.city, restore: saved! });
    });
    el.querySelector('#go')!.addEventListener('click', () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
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
  el.className = 'loading';
  el.innerHTML = `${slopLogoHTML()}<div class="load-tip" id="load-tip">${TIPS[0]}</div><div class="load-bar"><span></span></div>`;
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
