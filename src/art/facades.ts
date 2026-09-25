// Material tiles: wall surfaces, window facades, roofs, ground, decals and
// small emissive bits. Scale notes (meters per tile) live next to each tile;
// the building generators use the same numbers (see buildings/mats.ts).
import { defTile, Layer } from './atlas';
import { Ctx, rngFor, speckle, grime, rr, circle, ellipse, stripes, drawText, textFit, linesFit, F, mix, shade, star, gradV } from './draw';
import type { Rng } from '../core/rng';

type P = (c: Ctx, w: number, h: number, L: Layer) => void;

function fill(c: Ctx, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(0, 0, w, h);
}

// Low-frequency surfaces don't need full resolution; saves atlas space for signs.
const LOW_RES: Record<string, number> = {
  gravel: 0.5, gravelRoof: 0.5, dirt: 0.5, lawnDry: 0.5, stucco: 0.5, rollup: 0.5, metalRoof: 0.5,
  metalPanel: 0.5, tiltup: 0.5, aptSiding: 0.75, midrise: 0.75, towerResi: 0.75,
};

function wall(name: string, w: number, h: number, paint: P, emissive = false, res = LOW_RES[name] ?? 1) {
  defTile(name, w, h, paint, { wrap: true, emissive, res });
}
function decal(name: string, w: number, h: number, paint: P, emissive = false) {
  defTile(name, w, h, paint, { wrap: false, emissive, shrink: false });
}

// ------------------------------------------------------------------ window helpers
const LIT = ['#ffcf7a', '#ffd89a', '#ffe7b8', '#ffc46b', '#cfe3ff', '#f4f0ff', '#8fb4ff'];

function litColor(r: Rng) {
  const x = r.float();
  return x < 0.55 ? LIT[Math.floor(r.float() * 4)] : x < 0.85 ? LIT[4 + Math.floor(r.float() * 2)] : LIT[6];
}

interface WinOpts {
  frame?: string;
  frameW?: number;
  cols?: number;
  rows?: number;
  glassTop?: string;
  glassBot?: string;
  curtain?: string | null;
  sill?: string | null;
  lit?: boolean;
  litCol?: string;
  blinds?: boolean;
  arch?: boolean;
}

/** One window. On the emissive layer only the lit glass is drawn. */
function win(c: Ctx, L: Layer, x: number, y: number, w: number, h: number, o: WinOpts = {}) {
  const fw = o.frameW ?? Math.max(2, w * 0.07);
  if (L === 'e') {
    if (!o.lit) return;
    const g = c.createLinearGradient(0, y, 0, y + h);
    const lc = o.litCol ?? '#ffcf7a';
    g.addColorStop(0, lc);
    g.addColorStop(1, shade(lc, -0.35));
    c.fillStyle = g;
    if (o.arch) {
      c.beginPath();
      c.moveTo(x + fw, y + h - fw);
      c.lineTo(x + fw, y + w / 2);
      c.arc(x + w / 2, y + w / 2, w / 2 - fw, Math.PI, 0);
      c.lineTo(x + w - fw, y + h - fw);
      c.closePath();
      c.fill();
    } else c.fillRect(x + fw, y + fw, w - fw * 2, h - fw * 2);
    if (o.curtain) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x + fw, y + fw, (w - fw * 2) * 0.22, h - fw * 2);
      c.fillRect(x + w - fw - (w - fw * 2) * 0.22, y + fw, (w - fw * 2) * 0.22, h - fw * 2);
    }
    // mullions stay dark
    c.fillStyle = '#000';
    const cols = o.cols ?? 1, rows = o.rows ?? 1;
    for (let i = 1; i < cols; i++) c.fillRect(x + (i * w) / cols - fw * 0.3, y, fw * 0.6, h);
    for (let j = 1; j < rows; j++) c.fillRect(x, y + (j * h) / rows - fw * 0.3, w, fw * 0.6);
    return;
  }
  const frame = o.frame ?? '#f2f0ea';
  c.save();
  if (o.arch) {
    c.beginPath();
    c.moveTo(x, y + h);
    c.lineTo(x, y + w / 2);
    c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    c.lineTo(x + w, y + h);
    c.closePath();
    c.fillStyle = frame;
    c.fill();
    c.clip();
  } else {
    c.fillStyle = frame;
    c.fillRect(x, y, w, h);
  }
  const gx = x + fw, gy = y + fw, gw = w - fw * 2, gh = h - fw * 2;
  const g = c.createLinearGradient(gx, gy, gx + gw * 0.4, gy + gh);
  g.addColorStop(0, o.glassTop ?? '#6f8596');
  g.addColorStop(0.5, o.glassBot ?? '#26323d');
  g.addColorStop(1, shade(o.glassBot ?? '#26323d', -0.3));
  c.fillStyle = g;
  c.fillRect(gx, gy, gw, gh);
  if (o.lit) {
    c.fillStyle = 'rgba(255,214,150,0.18)';
    c.fillRect(gx, gy, gw, gh);
  }
  // reflection streak
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.beginPath();
  c.moveTo(gx + gw * 0.15, gy);
  c.lineTo(gx + gw * 0.45, gy);
  c.lineTo(gx + gw * 0.05, gy + gh);
  c.lineTo(gx - gw * 0.1, gy + gh);
  c.closePath();
  c.fill();
  if (o.blinds) {
    c.fillStyle = 'rgba(230,225,210,0.55)';
    const bh = gh * (0.3 + ((x * 7 + y * 13) % 10) / 20);
    c.fillRect(gx, gy, gw, bh);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let yy = gy; yy < gy + bh; yy += 3) c.fillRect(gx, yy, gw, 1);
  }
  if (o.curtain) {
    c.fillStyle = o.curtain;
    c.fillRect(gx, gy, gw * 0.22, gh);
    c.fillRect(gx + gw * 0.78, gy, gw * 0.22, gh);
  }
  c.fillStyle = frame;
  const cols = o.cols ?? 1, rows = o.rows ?? 1;
  for (let i = 1; i < cols; i++) c.fillRect(x + (i * w) / cols - fw * 0.3, y, fw * 0.6, h);
  for (let j = 1; j < rows; j++) c.fillRect(x, y + (j * h) / rows - fw * 0.3, w, fw * 0.6);
  c.restore();
  if (o.sill !== null) {
    c.fillStyle = o.sill ?? shade(frame, -0.1);
    c.fillRect(x - fw * 0.8, y + h, w + fw * 1.6, fw * 1.1);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x - fw * 0.8, y + h + fw * 1.1, w + fw * 1.6, fw * 0.6);
  }
}

function acUnit(c: Ctx, x: number, y: number, w: number, h: number) {
  c.fillStyle = '#c9c6bd';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#8a877f';
  for (let i = 1; i < 5; i++) c.fillRect(x + 2, y + (i * h) / 5, w - 4, 1.2);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(x, y + h, w, 2);
  c.fillStyle = 'rgba(60,40,20,0.25)';
  c.fillRect(x + w * 0.4, y + h, 2, h * 1.5);
}

// ------------------------------------------------------------------ brick & masonry
function brickPattern(c: Ctx, w: number, h: number, bw: number, bh: number, base: string, mortar: string, r: Rng, vary = 0.12) {
  fill(c, w, h, mortar);
  const rows = Math.round(h / bh);
  const bhh = h / rows;
  const cols = Math.round(w / bw);
  const bww = w / cols;
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? bww / 2 : 0;
    for (let i = -1; i <= cols; i++) {
      const x = i * bww + off;
      const k = (r.float() - 0.5) * vary * 2;
      c.fillStyle = shade(base, k);
      c.fillRect(x + 0.8, j * bhh + 0.8, bww - 1.6, bhh - 1.6);
    }
  }
  speckle(c, w, h, r, w * h * 0.004, 0.18, 0.08, 1.5);
}

function stoneVeneer(c: Ctx, w: number, h: number, r: Rng) {
  fill(c, w, h, '#4d4740');
  const cols = ['#b7a78e', '#a3927a', '#c9bba2', '#8f8272', '#9d9a92', '#b8b0a2', '#7f7466', '#c2ae8f'];
  let y = 0;
  while (y < h) {
    const rh = 14 + r.float() * 16;
    let x = -r.float() * 20;
    while (x < w) {
      const sw = 18 + r.float() * 34;
      c.fillStyle = cols[Math.floor(r.float() * cols.length)];
      rr(c, x + 1.5, y + 1.5, sw - 3, rh - 3, 5);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      rr(c, x + 3, y + 2.5, sw * 0.5, rh * 0.3, 3);
      c.fill();
      x += sw;
    }
    y += rh;
  }
  speckle(c, w, h, r, 900, 0.2, 0.1, 1.6);
}

// ------------------------------------------------------------------ registration
export function registerFacades() {
  // --- neutral surfaces tinted by vertex color
  wall('plain', 64, 64, (c, w, h) => {
    fill(c, w, h, '#f0f0f0');
    speckle(c, w, h, rngFor('plain'), 120, 0.05, 0.03, 2);
  });
  wall('leaf', 128, 128, (c, w, h) => {
    const r = rngFor('leaf');
    fill(c, w, h, '#d8e2cc');
    for (let i = 0; i < 260; i++) {
      c.fillStyle = r.float() < 0.5 ? `rgba(40,60,20,${0.1 + r.float() * 0.25})` : `rgba(255,255,230,${r.float() * 0.25})`;
      circle(c, r.float() * w, r.float() * h, 2 + r.float() * 5);
      c.fill();
    }
  });
  wall('metal', 128, 128, (c, w, h) => {
    const r = rngFor('metal');
    gradV(c, 0, 0, w, h, '#e6e8ea', '#c9ccd0');
    speckle(c, w, h, r, 300, 0.06, 0.08, 1.5);
  });
  wall('rust', 128, 128, (c, w, h) => {
    const r = rngFor('rust');
    fill(c, w, h, '#8a5a3a');
    for (let i = 0; i < 120; i++) {
      c.fillStyle = ['#5a3420', '#a8683a', '#6b4a3a', '#7d7a70'][Math.floor(r.float() * 4)];
      circle(c, r.float() * w, r.float() * h, 3 + r.float() * 10);
      c.fill();
    }
    speckle(c, w, h, r, 500, 0.3, 0.1, 2);
  });

  // --- siding & wood (4m x 4m unless noted)
  wall('siding', 256, 256, (c, w, h) => {
    const r = rngFor('siding');
    fill(c, w, h, '#ecebe6');
    const n = 20;
    for (let i = 0; i < n; i++) {
      const y = (i * h) / n;
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(0, y, w, 1.5);
      const g = c.createLinearGradient(0, y, 0, y + h / n);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      c.fillStyle = g;
      c.fillRect(0, y, w, h / n);
    }
    speckle(c, w, h, r, 500, 0.05, 0.04, 1.5);
    grime(c, w, h, r, 0.06);
  });
  wall('sidingV', 256, 256, (c, w, h) => {
    const r = rngFor('sidingV');
    fill(c, w, h, '#f1f0ec');
    const n = 10;
    for (let i = 0; i < n; i++) {
      const x = (i * w) / n;
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(x + 5, 0, 2, h);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillRect(x, 0, 5, h);
      c.fillStyle = 'rgba(0,0,0,0.05)';
      c.fillRect(x + 7, 0, (w / n) - 7, h);
    }
    speckle(c, w, h, r, 400, 0.04, 0.03, 1.5);
  });
  wall('wood', 256, 256, (c, w, h) => {
    const r = rngFor('wood');
    const n = 16;
    for (let i = 0; i < n; i++) {
      const y = (i * h) / n;
      c.fillStyle = shade('#8a7560', (r.float() - 0.55) * 0.35);
      c.fillRect(0, y, w, h / n);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(0, y + h / n - 1.5, w, 1.5);
      c.strokeStyle = 'rgba(40,25,10,0.18)';
      c.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        const yy = y + 2 + r.float() * (h / n - 4);
        c.moveTo(0, yy);
        c.bezierCurveTo(w * 0.3, yy + r.float() * 3, w * 0.6, yy - r.float() * 3, w, yy);
        c.stroke();
      }
      // butt joints
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(r.float() * w, y, 1.5, h / n);
    }
    grime(c, w, h, r, 0.2);
  });
  wall('deck', 256, 256, (c, w, h) => {
    const r = rngFor('deck');
    const n = 18;
    for (let i = 0; i < n; i++) {
      c.fillStyle = shade('#9a7a58', (r.float() - 0.5) * 0.25);
      c.fillRect((i * w) / n, 0, w / n, h);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(((i + 1) * w) / n - 1.2, 0, 1.2, h);
    }
    speckle(c, w, h, r, 400, 0.12, 0.05, 1.5);
  });
  wall('trailer', 256, 192, (c, w, h) => {
    const r = rngFor('trailer');
    fill(c, w, h, '#f1efe8');
    for (let x = 0; x < w; x += 8) {
      c.fillStyle = 'rgba(0,0,0,0.08)';
      c.fillRect(x, 0, 2, h);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(x + 2, 0, 1, h);
    }
    c.fillStyle = '#7a5a3c';
    c.fillRect(0, h * 0.62, w, h * 0.1);
    c.fillStyle = '#a07a52';
    c.fillRect(0, h * 0.74, w, h * 0.03);
    grime(c, w, h, r, 0.18, '60,50,30');
    speckle(c, w, h, r, 300, 0.08, 0.04, 1.5);
  });
  // chain-link: no alpha in the atlas, so the "see-through" is a dusty mid tone
  wall('chainlink', 256, 128, (c, w, h) => {
    fill(c, w, h, '#707868');
    speckle(c, w, h, rngFor('chainlink'), 900, 0.12, 0.06, 2);
    c.strokeStyle = 'rgba(210,214,218,0.85)';
    c.lineWidth = 1.1;
    for (let x = -h; x < w + h; x += 7) {
      c.beginPath();
      c.moveTo(x, 6);
      c.lineTo(x + h, h + 6);
      c.moveTo(x + h, 6);
      c.lineTo(x, h + 6);
      c.stroke();
    }
    c.fillStyle = '#9aa0a4';
    c.fillRect(0, 0, w, 6);
    c.fillStyle = '#7a8084';
    for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 4, h);
    c.fillStyle = '#8a8e92';
    c.fillRect(0, h - 3, w, 3);
  });
  wall('lattice', 256, 64, (c, w, h) => {
    fill(c, w, h, '#2c2a26');
    c.strokeStyle = '#e9e4d8';
    c.lineWidth = 3;
    for (let x = -h; x < w + h; x += 16) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + h, h);
      c.moveTo(x + h, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    c.fillStyle = '#e9e4d8';
    c.fillRect(0, 0, w, 4);
  });
  wall('fence', 256, 128, (c, w, h) => {
    const r = rngFor('fence');
    const n = 22;
    for (let i = 0; i < n; i++) {
      c.fillStyle = shade('#9c7b58', (r.float() - 0.5) * 0.3);
      c.fillRect((i * w) / n, 6, w / n - 1, h - 6);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(((i + 1) * w) / n - 1, 6, 1, h);
    }
    c.fillStyle = '#8a6b4a';
    c.fillRect(0, 0, w, 7);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0, h * 0.3, w, 3);
    c.fillRect(0, h * 0.8, w, 3);
    grime(c, w, h, r, 0.2);
  });

  // --- masonry
  wall('brick', 256, 256, (c, w, h) => brickPattern(c, w, h, 25.6, 8.53, '#8e4a36', '#b3aa9c', rngFor('brick')));
  wall('brickTan', 256, 256, (c, w, h) => brickPattern(c, w, h, 25.6, 8.53, '#b89a72', '#d6cfc2', rngFor('brickTan')));
  wall('brickDark', 256, 256, (c, w, h) => brickPattern(c, w, h, 25.6, 8.53, '#5a3a32', '#8a8278', rngFor('brickDark'), 0.18));
  wall('stone', 256, 256, (c, w, h) => stoneVeneer(c, w, h, rngFor('stone')));
  wall('stucco', 256, 256, (c, w, h) => {
    const r = rngFor('stucco');
    fill(c, w, h, '#ece6da');
    speckle(c, w, h, r, 4000, 0.06, 0.06, 2);
    speckle(c, w, h, r, 200, 0.05, 0.05, 8);
    grime(c, w, h, r, 0.1);
  });
  wall('concrete', 256, 256, (c, w, h) => {
    const r = rngFor('concrete');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      c.fillStyle = shade('#b9b5ac', (r.float() - 0.5) * 0.08);
      c.fillRect(i * 128, j * 128, 128, 128);
    }
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(127, 0, 2, h);
    c.fillRect(0, 127, w, 2);
    c.fillStyle = 'rgba(0,0,0,0.2)';
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (const [a, b] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      circle(c, i * 128 + a * 128, j * 128 + b * 128, 2);
      c.fill();
    }
    speckle(c, w, h, r, 2500, 0.08, 0.06, 1.5);
    grime(c, w, h, r, 0.22);
  });
  wall('cinder', 256, 256, (c, w, h) => {
    const r = rngFor('cinder');
    fill(c, w, h, '#8f8b84');
    for (let j = 0; j < 16; j++) for (let i = -1; i < 9; i++) {
      c.fillStyle = shade('#b3afa6', (r.float() - 0.5) * 0.1);
      c.fillRect(i * 32 + (j % 2) * 16 + 1, j * 16 + 1, 30, 14);
    }
    speckle(c, w, h, r, 3000, 0.12, 0.05, 1.5);
    grime(c, w, h, r, 0.25);
  });
  wall('tiltup', 256, 256, (c, w, h) => {
    const r = rngFor('tiltup');
    fill(c, w, h, '#d9d2c3');
    c.fillStyle = '#b8ad98';
    c.fillRect(0, 0, w, 22);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(0, 22, w, 3);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(127, 0, 2, h);
    c.fillRect(0, h * 0.55, w, 1.5);
    speckle(c, w, h, r, 2000, 0.06, 0.05, 1.5);
    grime(c, w, h, r, 0.16);
  });
  wall('corrugated', 256, 256, (c, w, h) => {
    const r = rngFor('corrugated');
    for (let x = 0; x < w; x += 10.67) {
      const g = c.createLinearGradient(x, 0, x + 10.67, 0);
      g.addColorStop(0, '#9aa0a4');
      g.addColorStop(0.5, '#d6dadc');
      g.addColorStop(1, '#8a9094');
      c.fillStyle = g;
      c.fillRect(x, 0, 10.8, h);
    }
    grime(c, w, h, r, 0.18);
  });
  wall('corrugatedRust', 256, 256, (c, w, h) => {
    const r = rngFor('corrRust');
    for (let x = 0; x < w; x += 10.67) {
      const g = c.createLinearGradient(x, 0, x + 10.67, 0);
      g.addColorStop(0, '#7d7870');
      g.addColorStop(0.5, '#b0aba0');
      g.addColorStop(1, '#6f6a62');
      c.fillStyle = g;
      c.fillRect(x, 0, 10.8, h);
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(${130 + r.float() * 40},${60 + r.float() * 30},20,${0.25 + r.float() * 0.4})`;
      const x = r.float() * w, y = r.float() * h;
      ellipse(c, x, y, 4 + r.float() * 18, 6 + r.float() * 30);
      c.fill();
    }
    grime(c, w, h, r, 0.35, '110,50,15');
  });
  wall('metalPanel', 256, 256, (c, w, h) => {
    const r = rngFor('metalPanel');
    fill(c, w, h, '#d5d8d6');
    for (let y = 0; y < h; y += 64) {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(0, y + 62, w, 2);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(0, y, w, 2);
      c.fillStyle = 'rgba(0,0,0,0.04)';
      for (let x = 0; x < w; x += 16) c.fillRect(x, y + 4, 1, 56);
    }
    grime(c, w, h, r, 0.12);
  });
  wall('dcWall', 256, 256, (c, w, h) => {
    const r = rngFor('dcWall');
    fill(c, w, h, '#5a6068');
    for (let i = 0; i < 4; i++) {
      c.fillStyle = shade('#7a8088', (r.float() - 0.5) * 0.1);
      c.fillRect(i * 64 + 1, 0, 62, h);
    }
    for (let y = 30; y < h; y += 128) for (let i = 0; i < 4; i++) {
      c.fillStyle = '#2e3238';
      c.fillRect(i * 64 + 10, y, 44, 56);
      c.fillStyle = '#8a9098';
      for (let k = 0; k < 8; k++) c.fillRect(i * 64 + 10, y + k * 7 + 2, 44, 2);
    }
    speckle(c, w, h, r, 800, 0.1, 0.05, 1.5);
  });
  wall('grille', 128, 128, (c, w, h) => {
    fill(c, w, h, '#2e3136');
    for (let y = 0; y < h; y += 8) {
      c.fillStyle = '#6a7078';
      c.fillRect(0, y, w, 3);
      c.fillStyle = '#1a1c20';
      c.fillRect(0, y + 3, w, 2);
    }
  });
  wall('glassPlain', 128, 128, (c, w, h) => {
    gradV(c, 0, 0, w, h, '#8fa7b8', '#2c3a46');
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.moveTo(20, 0);
    c.lineTo(60, 0);
    c.lineTo(10, h);
    c.lineTo(-30, h);
    c.fill();
    c.fillStyle = '#2a2e33';
    c.fillRect(0, 0, 3, h);
    c.fillRect(0, 0, w, 3);
  });
  wall('solar', 256, 256, (c, w, h) => {
    fill(c, w, h, '#c8ccd0');
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) {
      const g = c.createLinearGradient(0, j * 64, 0, j * 64 + 60);
      g.addColorStop(0, '#3a5a9a');
      g.addColorStop(1, '#1a2a4a');
      c.fillStyle = g;
      c.fillRect(i * 128 + 3, j * 64 + 3, 122, 58);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      for (let k = 1; k < 6; k++) c.fillRect(i * 128 + 3 + k * 20, j * 64 + 3, 1, 58);
      c.fillRect(i * 128 + 3, j * 64 + 32, 122, 1);
    }
  });

  // --- roofs
  wall('shingles', 256, 256, (c, w, h) => {
    const r = rngFor('shingles');
    fill(c, w, h, '#5a5754');
    const rowH = 9.14;
    for (let j = 0; j < 28; j++) {
      const off = (j % 2) * 10.5;
      for (let i = -1; i < 13; i++) {
        c.fillStyle = shade('#77736e', (r.float() - 0.5) * 0.22);
        c.fillRect(i * 21 + off + 0.5, j * rowH, 20, rowH - 1.5);
      }
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(0, j * rowH + rowH - 1.5, w, 1.5);
    }
    speckle(c, w, h, r, 3000, 0.15, 0.08, 1.2);
    grime(c, w, h, r, 0.15, '20,25,20');
  });
  wall('metalRoof', 256, 256, (c, w, h) => {
    const r = rngFor('metalRoof');
    fill(c, w, h, '#b9bcbf');
    for (let x = 0; x < w; x += 25.6) {
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillRect(x, 0, 2, h);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(x + 2, 0, 1.5, h);
    }
    speckle(c, w, h, r, 500, 0.06, 0.05, 1.5);
  });
  wall('flatRoof', 256, 256, (c, w, h) => {
    const r = rngFor('flatRoof');
    fill(c, w, h, '#a9a7a1');
    for (let i = 0; i < 4; i++) {
      c.fillStyle = shade('#b3b1ab', (r.float() - 0.5) * 0.08);
      c.fillRect(0, i * 64, w, 63);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(0, i * 64 + 62, w, 2);
    }
    for (let i = 0; i < 7; i++) {
      c.fillStyle = `rgba(40,35,30,${0.08 + r.float() * 0.12})`;
      ellipse(c, r.float() * w, r.float() * h, 10 + r.float() * 30, 8 + r.float() * 20);
      c.fill();
    }
    speckle(c, w, h, r, 2500, 0.1, 0.06, 1.5);
  });
  wall('gravelRoof', 256, 256, (c, w, h) => {
    const r = rngFor('gravelRoof');
    fill(c, w, h, '#8d8a84');
    speckle(c, w, h, r, 9000, 0.28, 0.2, 2);
  });

  // --- ground (8m x 8m unless noted)
  wall('asphalt', 256, 256, (c, w, h) => {
    const r = rngFor('asphalt');
    fill(c, w, h, '#47474a');
    speckle(c, w, h, r, 7000, 0.22, 0.12, 1.5);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = `rgba(0,0,0,${0.1 + r.float() * 0.15})`;
      ellipse(c, r.float() * w, r.float() * h, 8 + r.float() * 14, 5 + r.float() * 10);
      c.fill();
    }
    c.strokeStyle = 'rgba(20,20,20,0.5)';
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      let x = r.float() * w, y = r.float() * h;
      c.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r.float() - 0.5) * 30;
        y += (r.float() - 0.3) * 20;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  });
  // one row of 4 stalls: 10.8m wide x 5.5m deep; aisle side at the bottom (v=0)
  wall('parking', 512, 256, (c, w, h, L) => {
    if (L === 'e') {
      // sodium light pools from the lamp row behind the stalls (night only)
      for (const cx of [w * 0.25, w * 0.75]) {
        const gr = c.createRadialGradient(cx, 0, 10, cx, 0, h * 1.1);
        gr.addColorStop(0, 'rgba(255,150,60,0.55)');
        gr.addColorStop(0.6, 'rgba(255,120,40,0.18)');
        gr.addColorStop(1, 'rgba(255,110,30,0)');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
      }
      return;
    }
    const r = rngFor('parking');
    fill(c, w, h, '#48484b');
    speckle(c, w, h, r, 12000, 0.22, 0.12, 1.5);
    c.fillStyle = '#e8e6df';
    for (let i = 0; i < 4; i++) {
      const x = (i * w) / 4;
      c.fillRect(x - 2.5, 10, 5, h - 18);
      if (r.float() < 0.5) {
        c.fillStyle = `rgba(0,0,0,${0.15 + r.float() * 0.2})`;
        ellipse(c, x + w / 8, h * 0.45, 14, 22);
        c.fill();
        c.fillStyle = '#e8e6df';
      }
    }
    c.fillStyle = 'rgba(232,230,223,0.35)';
    c.fillRect(0, 8, w, 3);
    // wheel stops
    c.fillStyle = '#b9b5ac';
    for (let i = 0; i < 4; i++) c.fillRect((i * w) / 4 + 22, 18, w / 4 - 44, 7);
  }, true);
  wall('lawn', 256, 256, (c, w, h) => {
    const r = rngFor('lawn');
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#5f8f3a' : '#6a9a42';
      c.fillRect(0, (i * h) / 8, w, h / 8);
    }
    speckle(c, w, h, r, 6000, 0.14, 0.08, 1.8);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = r.float() < 0.5 ? 'rgba(240,240,200,0.5)' : 'rgba(60,90,30,0.4)';
      circle(c, r.float() * w, r.float() * h, 1 + r.float() * 1.5);
      c.fill();
    }
  });
  wall('lawnDry', 256, 256, (c, w, h) => {
    const r = rngFor('lawnDry');
    fill(c, w, h, '#8a8a4a');
    for (let i = 0; i < 30; i++) {
      c.fillStyle = ['#9a8a55', '#6f7a3a', '#a89868', '#7a6a4a'][Math.floor(r.float() * 4)];
      ellipse(c, r.float() * w, r.float() * h, 10 + r.float() * 30, 8 + r.float() * 20);
      c.fill();
    }
    speckle(c, w, h, r, 6000, 0.2, 0.1, 1.8);
  });
  wall('dirt', 256, 256, (c, w, h) => {
    const r = rngFor('dirt');
    fill(c, w, h, '#7d6a52');
    for (let i = 0; i < 30; i++) {
      c.fillStyle = ['#6e5c46', '#8d7a60', '#75664f'][Math.floor(r.float() * 3)];
      ellipse(c, r.float() * w, r.float() * h, 10 + r.float() * 26, 8 + r.float() * 20);
      c.fill();
    }
    speckle(c, w, h, r, 6000, 0.2, 0.1, 1.8);
  });
  wall('gravel', 256, 256, (c, w, h) => {
    const r = rngFor('gravel');
    fill(c, w, h, '#8e877c');
    speckle(c, w, h, r, 10000, 0.3, 0.25, 2.2);
  });
  wall('concretePad', 256, 256, (c, w, h) => {
    const r = rngFor('concretePad');
    fill(c, w, h, '#bdb9b0');
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) {
      c.fillRect((i * w) / 4, 0, 1.5, h);
      c.fillRect(0, (i * h) / 4, w, 1.5);
    }
    speckle(c, w, h, r, 3000, 0.08, 0.06, 1.5);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = `rgba(30,25,20,${0.06 + r.float() * 0.1})`;
      ellipse(c, r.float() * w, r.float() * h, 10 + r.float() * 20, 6 + r.float() * 12);
      c.fill();
    }
  });
  wall('pool', 256, 256, (c, w, h, L) => {
    const r = rngFor('pool');
    if (L === 'e') {
      fill(c, w, h, '#0b4a55');
      c.fillStyle = 'rgba(80,220,255,0.6)';
      for (let i = 0; i < 3; i++) {
        circle(c, (i + 0.5) * (w / 3), h * 0.5, 30);
        c.fill();
      }
      return;
    }
    gradV(c, 0, 0, w, h, '#3fc1d6', '#1f8fb0');
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) {
      c.beginPath();
      const x = r.float() * w, y = r.float() * h;
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 10, y + (r.float() - 0.5) * 12, x + 20 + r.float() * 10, y);
      c.stroke();
    }
  }, true);
  wall('mulch', 128, 128, (c, w, h) => {
    const r = rngFor('mulch');
    fill(c, w, h, '#6b3f26');
    speckle(c, w, h, r, 3000, 0.3, 0.12, 2);
  });
  wall('bleachers', 256, 256, (c, w, h) => {
    const r = rngFor('bleachers');
    fill(c, w, h, '#6a6f75');
    for (let j = 0; j < 8; j++) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0, j * 32 + 26, w, 6);
      for (let i = 0; i < 16; i++) {
        const filled = r.float() < 0.55;
        c.fillStyle = filled ? ['#e6c3a0', '#b3202a', '#1d3a8a', '#f4efe2', '#111', '#c6f432'][Math.floor(r.float() * 6)] : '#1d4fa3';
        rr(c, i * 16 + 2, j * 32 + (filled ? 6 : 12), 12, filled ? 20 : 14, 3);
        c.fill();
      }
    }
  });
  wall('carWin', 128, 32, (c, w, h) => {
    gradV(c, 0, 0, w, h, '#7d93a6', '#1d2833');
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 0, 4, h);
    c.fillRect(w * 0.48, 0, 5, h);
  });
  wall('laundry', 256, 64, (c, w, h) => {
    const r = rngFor('laundry');
    c.clearRect(0, 0, w, h);
    fill(c, w, h, '#4a4640');
    c.strokeStyle = '#ddd';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, 6);
    c.lineTo(w, 6);
    c.stroke();
    let x = 2;
    while (x < w - 10) {
      const cw = 12 + r.float() * 24;
      const ch = 18 + r.float() * 36;
      c.fillStyle = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#8ecae6', '#fb8500', '#ffffff', '#2a9d8f', '#e9c46a'][Math.floor(r.float() * 10)];
      if (r.float() < 0.3) {
        // t-shirt
        c.beginPath();
        c.moveTo(x, 8);
        c.lineTo(x + cw, 8);
        c.lineTo(x + cw + 4, 16);
        c.lineTo(x + cw - 2, 18);
        c.lineTo(x + cw - 2, 8 + ch);
        c.lineTo(x + 2, 8 + ch);
        c.lineTo(x + 2, 18);
        c.lineTo(x - 4, 16);
        c.closePath();
        c.fill();
      } else c.fillRect(x, 7, cw, ch);
      x += cw + 3 + r.float() * 8;
    }
  });
  decal('flag', 256, 160, (c, w, h) => {
    stripes(c, 0, 0, w, h, ['#b3202a', '#f4efe2'], 13);
    c.fillStyle = '#1d3a8a';
    c.fillRect(0, 0, w * 0.4, h * 0.54);
    c.fillStyle = '#fff';
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) {
      star(c, 10 + i * 16 + (j % 2) * 8, 10 + j * 16, 4.5);
      c.fill();
    }
    gradV(c, 0, 0, w, h, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)');
  });

  // --- window facades (wrap). bays x floors noted; generators use the same.
  // aptBrick: 4 bays x 4 floors, 3m x 3m
  wall('aptBrick', 512, 512, (c, w, h, L) => {
    const rw = rngFor('aptBrick:w');
    if (L === 'a') brickPattern(c, w, h, 12.8, 4.27, '#8a4b38', '#aa9f90', rngFor('aptBrick'));
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 38, y = j * 128 + 30;
      const lit = rw.float() < 0.42, col = litColor(rw), ac = rw.float() < 0.25, cur = rw.float() < 0.5;
      if (L === 'a') {
        c.fillStyle = '#c8c0b0';
        c.fillRect(x - 6, y - 10, 64, 9);
      }
      win(c, L, x, y, 52, 70, { cols: 1, rows: 2, lit, litCol: col, curtain: cur ? '#d9c9a8' : null, frame: '#e9e5dc' });
      if (L === 'a' && ac) acUnit(c, x + 8, y + 58, 36, 20);
    }
    if (L === 'a') grime(c, w, h, rngFor('aptBrick:g'), 0.18);
  }, true);
  // aptSiding: garden apartments, 4 bays x 4 floors, 3m x 3m (tan siding baked in)
  wall('aptSiding', 512, 512, (c, w, h, L) => {
    const rw = rngFor('aptSiding:w');
    if (L === 'a') {
      fill(c, w, h, '#e3dccb');
      for (let y = 0; y < h; y += 6.4) {
        c.fillStyle = 'rgba(0,0,0,0.08)';
        c.fillRect(0, y + 5, w, 1.4);
      }
      for (let j = 0; j < 4; j++) {
        c.fillStyle = '#cfc5ae';
        c.fillRect(0, j * 128 + 124, w, 4);
      }
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 34, y = j * 128 + 30;
      const lit = rw.float() < 0.45, col = litColor(rw);
      if (L === 'a') {
        c.fillStyle = '#3d4a3a';
        c.fillRect(x - 18, y - 2, 14, 74);
        c.fillRect(x + 64, y - 2, 14, 74);
      }
      win(c, L, x, y, 60, 70, { cols: 2, rows: 2, lit, litCol: col, blinds: rw.float() < 0.6, frame: '#f4f1ea' });
    }
    if (L === 'a') grime(c, w, h, rngFor('aptSiding:g'), 0.08);
  }, true);
  // fiveOver: 4 bays x 4 floors, 3.2m x 3.2m, the colorful fiber-cement panels
  wall('fiveOver', 512, 512, (c, w, h, L) => {
    const rw = rngFor('fiveOver:w');
    const rp = rngFor('fiveOver:p');
    if (L === 'a') {
      fill(c, w, h, '#9a9c9a');
      const pal = ['#e07a3f', '#2a9d8f', '#3a3a3c', '#e9e2d0', '#d9b43f', '#6d7278', '#b5563a', '#e9e2d0', '#3a3a3c'];
      // vertical panel stacks of random widths
      let x = 0;
      while (x < w) {
        const pw = [32, 64, 64, 96, 128][Math.floor(rp.float() * 5)];
        let y = 0;
        while (y < h) {
          const ph = [64, 128, 128, 256][Math.floor(rp.float() * 4)];
          c.fillStyle = pal[Math.floor(rp.float() * pal.length)];
          c.fillRect(x, y, pw, ph);
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.lineWidth = 1.5;
          c.strokeRect(x + 0.75, y + 0.75, pw - 1.5, ph - 1.5);
          y += ph;
        }
        x += pw;
      }
      speckle(c, w, h, rp, 3000, 0.06, 0.05, 1.5);
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 28, y = j * 128 + 22;
      const lit = rw.float() < 0.5, col = litColor(rw), juliet = rw.float() < 0.4;
      win(c, L, x, y, 72, 92, { cols: 2, rows: 1, lit, litCol: col, frame: '#202224', blinds: rw.float() < 0.4, sill: null });
      if (L === 'a' && juliet) {
        c.fillStyle = '#111';
        c.fillRect(x - 4, y + 60, 80, 3);
        for (let k = 0; k <= 8; k++) c.fillRect(x - 4 + k * 10, y + 60, 1.5, 32);
      }
    }
  }, true);
  // podium: ground floor retail of a 5-over-1, 4 bays x 1 floor, 4m x 4.5m
  wall('podium', 512, 256, (c, w, h, L) => {
    const rw = rngFor('podium:w');
    if (L === 'a') {
      fill(c, w, h, '#5b5e62');
      c.fillStyle = '#2c2e31';
      c.fillRect(0, 0, w, 26);
    }
    const labels = ['FOR LEASE', 'COMING SOON: ARTISANAL SOMETHING', 'FOR LEASE', 'LEASING OFFICE'];
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 10;
      const lit = rw.float() < 0.5;
      if (L === 'e') {
        if (lit) {
          c.fillStyle = '#ffe6b0';
          c.fillRect(x + 4, 44, 100, 190);
        }
        continue;
      }
      c.fillStyle = '#7d8084';
      c.fillRect(x - 10, 26, 10, h);
      const g = c.createLinearGradient(x, 40, x + 60, 240);
      g.addColorStop(0, '#6d8394');
      g.addColorStop(1, '#1b252e');
      c.fillStyle = g;
      c.fillRect(x, 40, 108, 200);
      c.fillStyle = '#1b1c1e';
      c.fillRect(x, 40, 108, 4);
      c.fillRect(x + 53, 40, 3, 200);
      c.fillRect(x, 150, 108, 3);
      const lab = labels[i];
      if (lab === 'FOR LEASE') {
        c.fillStyle = '#f4f1ea';
        c.fillRect(x + 20, 90, 70, 44);
        linesFit(c, ['FOR LEASE', '555-0199'], x + 22, 92, 66, 40, { family: F.sans, weight: 900, color: '#b3202a' });
      } else if (lab.startsWith('COMING')) {
        c.fillStyle = '#efe6cf';
        c.fillRect(x + 6, 70, 96, 60);
        linesFit(c, ['COMING SOON', 'ARTISANAL', 'SOMETHING'], x + 8, 72, 92, 56, { family: F.block, color: '#111' });
      } else {
        linesFit(c, ['LEASING', 'OFFICE'], x + 14, 60, 80, 36, { family: F.sans, weight: 800, color: '#f4f1ea' });
      }
    }
  }, true);
  // midrise: 4 bays x 4 floors, 3.2m x 3.2m precast with punched windows + AC units
  wall('midrise', 512, 512, (c, w, h, L) => {
    const rw = rngFor('midrise:w');
    if (L === 'a') {
      fill(c, w, h, '#c9bfae');
      speckle(c, w, h, rngFor('midrise'), 4000, 0.08, 0.05, 1.5);
      for (let j = 0; j < 4; j++) {
        c.fillStyle = '#b3a896';
        c.fillRect(0, j * 128 + 112, w, 16);
      }
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 26, y = j * 128 + 18;
      const lit = rw.float() < 0.45, col = litColor(rw), ac = rw.float() < 0.3;
      win(c, L, x, y, 76, 84, { cols: 2, rows: 1, lit, litCol: col, frame: '#5a5650', blinds: rw.float() < 0.5, curtain: rw.float() < 0.3 ? '#c9b48a' : null, sill: null });
      if (L === 'a' && ac) acUnit(c, x + 20, y + 62, 36, 22);
    }
    if (L === 'a') grime(c, w, h, rngFor('midrise:g'), 0.25);
  }, true);
  // towerResi: 4 bays x 4 floors, 3.2m x 3.2m glass + slab edges + balconies
  wall('towerResi', 512, 512, (c, w, h, L) => {
    const rw = rngFor('towerResi:w');
    for (let j = 0; j < 4; j++) {
      const y = j * 128;
      if (L === 'a') {
        gradV(c, 0, y, w, 110, '#8aa3b5', '#2c3c4a');
        c.fillStyle = '#d8d4cc';
        c.fillRect(0, y + 110, w, 18);
        // balcony glass rails
        c.fillStyle = 'rgba(200,225,235,0.35)';
        c.fillRect(0, y + 78, w, 32);
        c.fillStyle = '#e8e4dc';
        c.fillRect(0, y + 78, w, 3);
      }
      for (let i = 0; i < 8; i++) {
        const lit = rw.float() < 0.45, col = litColor(rw);
        if (L === 'e') {
          if (lit) {
            c.fillStyle = col;
            c.fillRect(i * 64 + 4, y + 6, 56, 100);
          }
        } else {
          c.fillStyle = '#394652';
          c.fillRect(i * 64, y, 3, 110);
          if (lit) {
            c.fillStyle = 'rgba(255,220,160,0.12)';
            c.fillRect(i * 64 + 3, y, 61, 110);
          }
        }
      }
    }
  }, true);
  // megablock: 4 bays x 4 floors, 3m x 3m. Tokyo meets Delhi.
  wall('megablock', 512, 512, (c, w, h, L) => {
    const rw = rngFor('mega:w');
    const rp = rngFor('mega:p');
    if (L === 'a') {
      const pal = ['#a39b8c', '#8f9a94', '#b8a58a', '#9aa0a6', '#a88a7a', '#c2b8a0'];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        c.fillStyle = pal[Math.floor(rp.float() * pal.length)];
        c.fillRect(i * 128, j * 128, 128, 128);
      }
      speckle(c, w, h, rp, 6000, 0.14, 0.06, 1.8);
      for (let j = 0; j < 4; j++) {
        c.fillStyle = '#6f6a62';
        c.fillRect(0, j * 128 + 118, w, 10);
      }
    }
    const LAUNDRY = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#fb8500'];
    const NEON = ['#ff2bd6', '#34f5ff', '#c6f432', '#ff4b1f'];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 22, y = j * 128 + 20;
      // every random draw happens in both passes so albedo and emissive agree
      const lit = rw.float() < 0.55, col = litColor(rw);
      const bars = rw.float() < 0.5, ac = rw.float() < 0.6, laundry = rw.float() < 0.45, dish = rw.float() < 0.2, neon = rw.float() < 0.12;
      const curtain = rw.float() < 0.5 ? ['#c43', '#3a7', '#dd4', '#48c'][Math.floor(rw.float() * 4)] : null;
      const neonCol = NEON[Math.floor(rw.float() * 4)];
      const clothes = Array.from({ length: 6 }, () => [LAUNDRY[Math.floor(rw.float() * 6)], 14 + rw.float() * 14] as const);
      win(c, L, x, y, 70, 64, { cols: 2, rows: 1, lit, litCol: col, frame: '#4a4a48', curtain, sill: null });
      if (L === 'a') {
        if (bars) {
          c.fillStyle = '#2a2a2a';
          for (let k = 0; k < 8; k++) c.fillRect(x + k * 10, y, 1.5, 64);
          c.fillRect(x, y + 30, 70, 1.5);
        }
        if (ac) acUnit(c, x + 74, y + 30, 28, 22);
        if (dish) {
          c.fillStyle = '#ddd';
          ellipse(c, x + 90, y + 10, 10, 12);
          c.fill();
        }
        // cables
        c.strokeStyle = 'rgba(20,20,20,0.6)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + 100, y - 20);
        c.quadraticCurveTo(x + 104, y + 40, x + 98, y + 100);
        c.stroke();
      }
      if (laundry) {
        if (L === 'a') {
          c.strokeStyle = '#ddd';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(x - 10, y + 70);
          c.lineTo(x + 90, y + 70);
          c.stroke();
        }
        clothes.forEach(([cc, ch], k) => {
          c.fillStyle = L === 'a' ? cc : '#000';
          c.fillRect(x - 6 + k * 15, y + 70, 11, ch);
        });
      }
      if (neon) {
        c.fillStyle = neonCol;
        c.fillRect(x + 76, y - 12, 6, 70);
      }
    }
    if (L === 'a') grime(c, w, h, rngFor('mega:g'), 0.4, '40,34,26');
  }, true);
  // glass curtain walls: 4 bays x 4 floors, 3m x 3.8m
  const curtain = (name: string, top: string, bot: string, mull: string, spandrel: string, litP: number, warm: boolean, res = 1) =>
    wall(name, 512, 512, (c, w, h, L) => {
      const rw = rngFor(name + ':w');
      const rp = rngFor(name + ':p');
      for (let j = 0; j < 4; j++) {
        const y = j * 128;
        if (L === 'a') {
          const g = c.createLinearGradient(0, y, 0, y + 128);
          g.addColorStop(0, top);
          g.addColorStop(1, bot);
          c.fillStyle = g;
          c.fillRect(0, y, w, 128);
          c.fillStyle = spandrel;
          c.fillRect(0, y + 100, w, 28);
        }
        for (let i = 0; i < 4; i++) {
          const lit = rw.float() < litP, part = rw.float(), warmLit = warm && rw.float() < 0.3;
          const x = i * 128;
          if (L === 'e') {
            if (lit) {
              c.fillStyle = warmLit ? '#ffe2a8' : '#dfe9ff';
              c.fillRect(x + 3, y + 3, 125 * (part < 0.3 ? 0.5 : 1), 96);
              c.fillStyle = 'rgba(0,0,0,0.5)';
              for (let k = 0; k < 3; k++) c.fillRect(x + 12 + k * 40, y + 60, 26, 30);
            }
            continue;
          }
          // subtle per-panel tint variation + reflections
          c.fillStyle = `rgba(255,255,255,${rp.float() * 0.08})`;
          c.fillRect(x, y, 128, 100);
          if (lit) {
            c.fillStyle = 'rgba(255,245,220,0.10)';
            c.fillRect(x, y, 128, 100);
          }
        }
        if (L === 'a') {
          c.fillStyle = mull;
          for (let i = 0; i <= 8; i++) c.fillRect(i * 64 - 1.5, y, 3, 128);
          c.fillRect(0, y + 99, w, 3);
          c.fillRect(0, y, w, 2);
        }
      }
      if (L === 'a') {
        // big diagonal sky reflection
        c.fillStyle = 'rgba(255,255,255,0.07)';
        c.beginPath();
        c.moveTo(w * 0.1, 0);
        c.lineTo(w * 0.55, 0);
        c.lineTo(w * 0.2, h);
        c.lineTo(-w * 0.25, h);
        c.fill();
      }
    }, true, res);
  curtain('glassA', '#9fbccc', '#3d5f73', '#c2ccd2', '#42596a', 0.55, false);
  curtain('glassB', '#4a4f55', '#141619', '#2a2d31', '#1f2226', 0.5, true, 0.75);
  curtain('glassC', '#8fc0b0', '#2f5a52', '#b8c8c2', '#34564e', 0.5, false, 0.75);
  // officeBand: ribbon windows, 4 bays x 4 floors, 3m x 3.6m
  wall('officeBand', 512, 512, (c, w, h, L) => {
    const rw = rngFor('officeBand:w');
    for (let j = 0; j < 4; j++) {
      const y = j * 128;
      if (L === 'a') {
        fill2(c, 0, y, w, 128, '#cfc8b8');
        gradV(c, 0, y + 44, w, 60, '#6c8090', '#1e2a33');
        c.fillStyle = '#9a9384';
        for (let i = 0; i <= 8; i++) c.fillRect(i * 64 - 1, y + 44, 2, 60);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(0, y + 104, w, 3);
      }
      for (let i = 0; i < 8; i++) {
        const lit = rw.float() < 0.5;
        if (L === 'e' && lit) {
          c.fillStyle = '#e4ecff';
          c.fillRect(i * 64 + 2, y + 46, 60, 56);
        } else if (L === 'a' && lit) {
          c.fillStyle = 'rgba(230,230,210,0.35)';
          c.fillRect(i * 64 + 2, y + 44, 60, 18);
        }
      }
    }
    if (L === 'a') grime(c, w, h, rngFor('officeBand:g'), 0.15);
  }, true, 0.75);
  // neonFacade: commercial high-rise, 4 bays x 4 floors, 3m x 3.5m, with little signs
  wall('neonFacade', 512, 512, (c, w, h, L) => {
    const rw = rngFor('neon:w');
    const words = ['KARAOKE', 'NOODLES', 'VAPE', 'PAWN', 'LOANS', 'BAR', 'HOTEL', 'SLOP', 'MASSAGE*', 'ARCADE', 'CRYPTO', 'SUSHI', 'NAILS', 'BOBA', 'TAX'];
    const cols = ['#ff2bd6', '#34f5ff', '#c6f432', '#ffb800', '#ff4b1f', '#8a5cff'];
    if (L === 'a') {
      fill(c, w, h, '#3b3d44');
      speckle(c, w, h, rngFor('neon'), 3000, 0.15, 0.05, 1.5);
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + 14, y = j * 128 + 16;
      win(c, L, x, y, 100, 80, { cols: 3, rows: 1, lit: rw.float() < 0.6, litCol: litColor(rw), frame: '#222', sill: null });
      if (rw.float() < 0.45) {
        const word = words[Math.floor(rw.float() * words.length)];
        const col = cols[Math.floor(rw.float() * cols.length)];
        const vert = rw.float() < 0.5;
        c.save();
        if (vert) {
          c.fillStyle = L === 'a' ? '#15161a' : '#000';
          c.fillRect(x + 104, y - 12, 20, 110);
          c.translate(x + 114, y + 43);
          c.rotate(Math.PI / 2);
          textFit(c, word, -52, -9, 104, 18, { family: F.sign, color: col });
        } else {
          c.fillStyle = L === 'a' ? '#15161a' : '#000';
          c.fillRect(x, y + 84, 100, 24);
          textFit(c, word, x + 3, y + 86, 94, 20, { family: F.sign, color: col });
        }
        c.restore();
      }
    }
  }, true);
  // storefront: 2 bays x 1 floor, 4m x 4m (strip malls)
  wall('storefront', 512, 256, (c, w, h, L) => {
    const rw = rngFor('storefront:w');
    for (let i = 0; i < 2; i++) {
      const x = i * 256;
      const door = i === 0;
      if (L === 'e') {
        c.fillStyle = rw.float() < 0.7 ? '#fff0cc' : '#dfe9ff';
        c.fillRect(x + 14, 40, 228, 200);
        c.fillStyle = '#000';
        c.fillRect(x + 125, 40, 6, 200);
        continue;
      }
      rw.float();
      c.fillStyle = '#8b8e91';
      c.fillRect(x, 0, 256, h);
      c.fillStyle = '#b9b5ac';
      c.fillRect(x, 0, 256, 36);
      const g = c.createLinearGradient(x, 40, x + 120, 240);
      g.addColorStop(0, '#75899a');
      g.addColorStop(0.6, '#26323c');
      g.addColorStop(1, '#161d23');
      c.fillStyle = g;
      c.fillRect(x + 14, 40, 228, 200);
      // shelves inside
      c.fillStyle = 'rgba(200,190,160,0.18)';
      for (let k = 0; k < 3; k++) c.fillRect(x + 20, 120 + k * 36, 216, 6);
      c.fillStyle = '#2a2c2f';
      c.fillRect(x + 12, 38, 232, 5);
      c.fillRect(x + 125, 40, 6, 200);
      c.fillRect(x + 12, 236, 232, 6);
      if (door) {
        c.fillStyle = '#2a2c2f';
        c.fillRect(x + 150, 90, 4, 150);
        c.fillRect(x + 212, 90, 4, 150);
        c.fillRect(x + 150, 90, 66, 4);
        c.fillStyle = '#c9c9c9';
        c.fillRect(x + 158, 160, 18, 3);
        textFit(c, 'OPEN', x + 40, 70, 60, 22, { family: F.sans, weight: 900, color: '#e63946' });
      } else {
        const posters = [['SALE'], ['WE BUY', 'GOLD'], ['NOW', 'HIRING'], ['LOTTO'], ['CASH', 'ONLY'], ['ATM', 'INSIDE']];
        const p = posters[Math.floor(rw.float() * posters.length)];
        c.fillStyle = ['#ffd400', '#ffffff', '#ff6b6b'][Math.floor(rw.float() * 3)];
        c.fillRect(x + 40, 110, 64, 64);
        linesFit(c, p, x + 43, 114, 58, 56, { family: F.block, color: '#111' });
      }
    }
    speckle(c, w, h, rngFor('storefront'), 600, 0.08, 0.04, 1.5);
  }, true);
  // officeLow: 4 bays x 1 floor, 3m x 3.6m. Content farms get ring lights.
  wall('officeLow', 512, 256, (c, w, h, L) => {
    const rw = rngFor('officeLow:w');
    if (L === 'a') {
      fill(c, w, h, '#d9d4c8');
      c.fillStyle = '#c3bcae';
      c.fillRect(0, 0, w, 30);
    }
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 14, y = 56;
      const lit = rw.float() < 0.7, ring = rw.float() < 0.5;
      win(c, L, x, y, 100, 150, { cols: 2, rows: 1, lit, litCol: '#eef2ff', frame: '#3a3c40', blinds: !ring, sill: null });
      if (ring) {
        c.strokeStyle = L === 'e' ? '#ffffff' : '#fff6f0';
        c.lineWidth = 5;
        circle(c, x + 50, y + 70, 28);
        c.stroke();
        if (L === 'e') {
          c.strokeStyle = '#ff9ad5';
          c.lineWidth = 2;
          circle(c, x + 50, y + 70, 22);
          c.stroke();
        }
      }
    }
  }, true);
  // docks: 4 bays x 1, 4m x 5m loading docks on metal panel
  wall('docks', 512, 256, (c, w, h, L) => {
    const r = rngFor('docks');
    if (L === 'e') {
      for (let i = 0; i < 4; i++) {
        c.fillStyle = '#ffb45a';
        c.fillRect(i * 128 + 56, 20, 16, 8);
      }
      return;
    }
    fill(c, w, h, '#cfd2cf');
    for (let y = 0; y < h; y += 51) {
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(0, y + 49, w, 2);
    }
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 20;
      c.fillStyle = '#23262a';
      c.fillRect(x - 4, 60, 96, 138);
      c.fillStyle = '#9ea4a8';
      c.fillRect(x, 64, 88, 130);
      c.fillStyle = 'rgba(0,0,0,0.2)';
      for (let k = 0; k < 10; k++) c.fillRect(x, 64 + k * 13, 88, 2);
      c.fillStyle = '#111';
      c.fillRect(x - 8, 180, 10, 30);
      c.fillRect(x + 86, 180, 10, 30);
      c.fillStyle = '#f2c230';
      for (let k = 0; k < 5; k++) c.fillRect(x - 4 + k * 20, 210, 10, 8);
      c.fillStyle = '#3a3e44';
      c.fillRect(x - 12, 214, 112, h - 214);
      drawText(c, String(10 + i), x + 44, 50, 22, { family: F.sans, weight: 900, color: '#222', align: 'center' });
      c.fillStyle = '#e9e2c6';
      c.fillRect(x + 36, 20, 16, 8);
    }
    grime(c, w, h, r, 0.16);
  }, true);
  // factoryWin: 4 bays x 1, 4m x 6m brick with multi-pane industrial windows
  wall('factoryWin', 512, 256, (c, w, h, L) => {
    const rw = rngFor('factoryWin:w');
    if (L === 'a') brickPattern(c, w, h, 12.8, 4.27, '#7a4232', '#9a9082', rngFor('factoryWin'), 0.15);
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 22, y = 40;
      const lit = rw.float() < 0.5;
      const broken = [0, 1, 2, 3].map(() => [rw.float() < 0.3, Math.floor(rw.float() * 6)] as const);
      win(c, L, x, y, 84, 170, { cols: 4, rows: 6, lit, litCol: '#ffb45a', frame: '#3b3f3a', glassTop: '#8a9a8a', glassBot: '#3a4a44', sill: '#8a8278' });
      broken.forEach(([b, row], k) => {
        if (!b) return;
        c.fillStyle = L === 'a' ? '#111' : '#000';
        c.fillRect(x + 4 + k * 20, y + 4 + row * 27, 16, 22);
      });
      if (L === 'a') {
        c.fillStyle = '#6a5a4a';
        c.beginPath();
        c.moveTo(x - 6, y);
        c.lineTo(x + 42, y - 18);
        c.lineTo(x + 90, y);
        c.fill();
      }
    }
    if (L === 'a') grime(c, w, h, rngFor('factoryWin:g'), 0.3);
  }, true);
  wall('garage1', 256, 208, (c, w, h) => garageDoor(c, w, h, 4));
  wall('garage2', 512, 208, (c, w, h) => garageDoor(c, w, h, 8));
  wall('rollup', 256, 256, (c, w, h) => {
    fill(c, w, h, '#a3a8ac');
    for (let y = 0; y < h; y += 8) {
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.fillRect(0, y + 6, w, 2);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(0, y, w, 1);
    }
    grime(c, w, h, rngFor('rollup'), 0.2);
  });

  // --- decals: windows (lit and unlit variants), doors, props
  const houseWin = (name: string, w: number, h: number, o: WinOpts & { shutters?: string; lit: boolean }) =>
    decal(name, w, h, (c, W, H, L) => {
      const sh = o.shutters ? W * 0.2 : 0;
      if (L === 'a' && o.shutters) {
        c.fillStyle = o.shutters;
        c.fillRect(0, 0, sh * 0.9, H);
        c.fillRect(W - sh * 0.9, 0, sh * 0.9, H);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = 4; y < H - 4; y += 6) {
          c.fillRect(3, y, sh * 0.9 - 6, 2);
          c.fillRect(W - sh * 0.9 + 3, y, sh * 0.9 - 6, 2);
        }
      }
      win(c, L, sh, 0, W - sh * 2, H * 0.94, { ...o, sill: o.sill === undefined ? undefined : o.sill });
    }, o.lit);
  for (const lit of [false, true]) {
    const s = lit ? 'Lit' : '';
    houseWin('winHouse' + s, 128, 176, { cols: 2, rows: 2, lit, litCol: '#ffcf7a', curtain: lit ? '#e8d9b8' : null, blinds: !lit });
    houseWin('winShutter' + s, 192, 176, { cols: 2, rows: 2, lit, litCol: '#ffd89a', shutters: '#2f3b33', blinds: !lit });
    houseWin('winPicture' + s, 256, 160, { cols: 3, rows: 1, lit, litCol: '#ffcf7a', curtain: '#d9c9a8' });
    houseWin('winTall' + s, 128, 288, { cols: 2, rows: 4, lit, litCol: '#ffe2a8', arch: true, frameW: 7 });
    houseWin('winModern' + s, 160, 208, { cols: 2, rows: 2, lit, litCol: '#ffe7b8', frame: '#151515', frameW: 8 });
    houseWin('winTrailer' + s, 176, 96, { cols: 2, rows: 1, lit, litCol: '#fff2c8', frame: '#c9ccd0', curtain: '#b36a4a' });
  }
  decal('winBoard', 128, 176, (c, w, h) => {
    const r = rngFor('winBoard');
    fill(c, w, h, '#3a3530');
    for (let i = 0; i < 4; i++) {
      c.save();
      c.translate(w / 2, h * (0.15 + i * 0.23));
      c.rotate((r.float() - 0.5) * 0.3);
      c.fillStyle = shade('#a08a68', (r.float() - 0.5) * 0.3);
      c.fillRect(-w * 0.6, -14, w * 1.2, 28);
      c.restore();
    }
  });
  decal('winPalladian', 256, 208, (c, w, h, L) => {
    win(c, L, 0, 60, 70, 140, { cols: 1, rows: 3, lit: true, litCol: '#ffe2a8' });
    win(c, L, 80, 0, 96, 200, { cols: 2, rows: 4, arch: true, lit: true, litCol: '#ffe2a8' });
    win(c, L, 186, 60, 70, 140, { cols: 1, rows: 3, lit: true, litCol: '#ffe2a8' });
  }, true);
  const door = (name: string, w: number, h: number, col: string, o: { glass?: boolean; side?: boolean; double?: boolean; arch?: boolean } = {}) =>
    decal(name, w, h, (c, W, H, L) => {
      if (L === 'e') {
        if (o.side || o.glass) {
          c.fillStyle = '#ffd89a';
          if (o.side) {
            c.fillRect(4, 10, W * 0.16, H - 20);
            c.fillRect(W - 4 - W * 0.16, 10, W * 0.16, H - 20);
          }
          if (o.glass) c.fillRect(W * 0.25, 20, W * 0.5, H * 0.7);
        }
        return;
      }
      fill(c, W, H, '#ebe7de');
      const dx = o.side ? W * 0.22 : 6;
      c.fillStyle = col;
      c.fillRect(dx, 8, W - dx * 2, H - 8);
      if (o.double) {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(W / 2 - 1, 8, 2, H);
      }
      if (o.glass) {
        const g = c.createLinearGradient(0, 20, 0, H);
        g.addColorStop(0, '#7890a0');
        g.addColorStop(1, '#1e2a33');
        c.fillStyle = g;
        c.fillRect(W * 0.25, 20, W * 0.5, H * 0.7);
      } else {
        c.fillStyle = 'rgba(0,0,0,0.18)';
        const pw = (W - dx * 2) / (o.double ? 4 : 2);
        for (let i = 0; i < (o.double ? 4 : 2); i++) {
          c.fillRect(dx + i * pw + pw * 0.18, 22, pw * 0.64, H * 0.36);
          c.fillRect(dx + i * pw + pw * 0.18, H * 0.52, pw * 0.64, H * 0.4);
        }
      }
      if (o.side) {
        c.fillStyle = '#5a7080';
        c.fillRect(4, 10, W * 0.16, H - 20);
        c.fillRect(W - 4 - W * 0.16, 10, W * 0.16, H - 20);
      }
      c.fillStyle = '#d4af37';
      circle(c, W - dx - 10, H * 0.55, 4);
      c.fill();
    }, !!(o.side || o.glass));
  door('doorFront', 112, 224, '#6b2c2c');
  door('doorBlue', 112, 224, '#23395b');
  door('doorBlack', 112, 224, '#1a1a1a');
  door('doorSide', 192, 224, '#3a2a1c', { side: true });
  door('doorDouble', 192, 224, '#4a2c1a', { double: true });
  door('doorTrailer', 96, 208, '#dcd6c8', { glass: true });
  door('doorGlass', 128, 224, '#2a2c2f', { glass: true });
  door('doorMetal', 112, 224, '#6f757a');

  decal('gather', 256, 64, (c, w, h) => {
    fill(c, w, h, '#6b4a2e');
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, h / 2, w, 2);
    textFit(c, 'Gather', 10, 4, w - 20, h - 8, { family: F.script, color: '#f4efe2' });
  });
  decal('liveLaughLease', 384, 64, (c, w, h) => {
    fill(c, w, h, '#f4efe2');
    textFit(c, 'Live Laugh Lease', 10, 6, w - 20, h - 12, { family: F.script, color: '#222' });
  });
  decal('acUnit', 128, 96, (c, w, h) => {
    fill(c, w, h, '#c9c6bd');
    c.fillStyle = '#6a6760';
    circle(c, w * 0.5, h * 0.5, h * 0.36);
    c.fill();
    c.strokeStyle = '#aaa79f';
    c.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.moveTo(w * 0.5, h * 0.5);
      c.lineTo(w * 0.5 + Math.cos(k * 1.57) * h * 0.34, h * 0.5 + Math.sin(k * 1.57) * h * 0.34);
      c.stroke();
    }
    grime(c, w, h, rngFor('acUnit'), 0.2);
  });
  decal('hvac', 128, 128, (c, w, h) => {
    fill(c, w, h, '#b9bab5');
    c.fillStyle = '#56585a';
    circle(c, w * 0.32, h * 0.5, 24);
    c.fill();
    circle(c, w * 0.72, h * 0.5, 24);
    c.fill();
    c.strokeStyle = '#8f918c';
    c.lineWidth = 2;
    for (const cx of [0.32, 0.72]) for (let r = 8; r < 24; r += 6) {
      circle(c, w * cx, h * 0.5, r);
      c.stroke();
    }
    grime(c, w, h, rngFor('hvac'), 0.2);
  });
  decal('pump', 128, 256, (c, w, h, L) => {
    if (L === 'e') {
      c.fillStyle = '#9ff7c8';
      c.fillRect(24, 40, 80, 40);
      c.fillStyle = '#ffffff';
      c.fillRect(10, 8, 108, 20);
      return;
    }
    fill(c, w, h, '#e8e8e4');
    c.fillStyle = '#b3202a';
    c.fillRect(0, 0, w, 36);
    textFit(c, 'GAS', 20, 6, 88, 26, { family: F.sign, color: '#fff' });
    c.fillStyle = '#111';
    c.fillRect(24, 40, 80, 40);
    c.fillStyle = '#9ff7c8';
    textFit(c, '$84.20', 28, 44, 72, 32, { family: F.sans, weight: 800, color: '#9ff7c8' });
    for (let i = 0; i < 3; i++) {
      c.fillStyle = ['#2e7d32', '#1d3a8a', '#ffd400'][i];
      c.fillRect(14 + i * 36, 100, 28, 20);
    }
    c.fillStyle = '#222';
    c.fillRect(20, 140, 88, 60);
    c.fillStyle = '#666';
    c.fillRect(46, 150, 36, 40);
    textFit(c, 'PAY INSIDE (PLEASE)', 10, 210, 108, 20, { family: F.sans, weight: 800, color: '#333' });
  }, true);
  decal('priceBoard', 256, 288, (c, w, h, L) => {
    const rows: [string, string][] = [['UNLEADED', '4.69'], ['PLUS', '4.99'], ['DIESEL', '5.69'], ['BEER', '12PK']];
    if (L === 'a') fill(c, w, h, '#f4f1ea');
    rows.forEach(([lab, pr], i) => {
      const y = 12 + i * 68;
      if (L === 'a') {
        c.fillStyle = '#111';
        c.fillRect(8, y, w - 16, 60);
        textFit(c, lab, 14, y + 6, 100, 22, { family: F.sans, weight: 900, color: '#f4f1ea' });
      }
      textFit(c, pr, 118, y + 4, 126, 52, { family: F.sign, color: L === 'e' ? '#ff5a3a' : '#ff3b2f' });
      if (L === 'a' && pr !== '12PK') drawText(c, '9', 238, y + 22, 16, { family: F.sans, weight: 900, color: '#ff3b2f', align: 'right' });
    });
  }, true);
  decal('menuBoard', 256, 160, (c, w, h, L) => {
    if (L === 'e') {
      c.fillStyle = '#fff2d8';
      c.fillRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#000';
      for (let i = 0; i < 6; i++) c.fillRect(20 + (i % 3) * 78, 30 + Math.floor(i / 3) * 60, 64, 40);
      return;
    }
    fill(c, w, h, '#1b1b1b');
    c.fillStyle = '#efe6cf';
    c.fillRect(6, 6, w - 12, h - 12);
    const items = ['#1 COMBO', '#2 COMBO', 'SPICY', 'LARGE ONLY', 'SWEET TEA', 'SAUCE $1'];
    items.forEach((it, i) => {
      const x = 16 + (i % 3) * 78, y = 20 + Math.floor(i / 3) * 64;
      c.fillStyle = ['#e0a458', '#b3202a', '#ffd400', '#6b3a1f', '#3a86ff', '#ff6b00'][i];
      c.fillRect(x, y, 70, 36);
      textFit(c, it, x, y + 38, 70, 16, { family: F.sans, weight: 900, color: '#111' });
    });
  }, true);
  decal('canopyLight', 128, 128, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#e9eaec');
    c.fillStyle = L === 'e' ? '#fffbef' : '#ffffff';
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      c.fillRect(16 + i * 64, 16 + j * 64, 32, 32);
    }
    if (L === 'e') {
      c.fillStyle = 'rgba(255,250,235,0.35)';
      c.fillRect(0, 0, w, h);
    }
  }, true);
  const glow = (name: string, col: string, day: string) =>
    decal(name, 32, 32, (c, w, h, L) => fill(c, w, h, L === 'e' ? col : day), true);
  glow('lampWarm', '#ffb45a', '#f6e7c8');
  glow('lampWhite', '#f4f6ff', '#f4f4f0');
  glow('neonPink', '#ff2bd6', '#ff5ad9');
  glow('neonCyan', '#34f5ff', '#6ef0f7');
  glow('neonLime', '#c6f432', '#c6f432');
  glow('neonRed', '#ff3b2f', '#e0453a');
  glow('screenGlow', '#dfe9ff', '#cfd8e8');
  decal('vending', 96, 192, (c, w, h, L) => {
    if (L === 'e') {
      c.fillStyle = '#c6f432';
      c.fillRect(8, 8, 56, 140);
      return;
    }
    fill(c, w, h, '#111');
    c.fillStyle = '#c6f432';
    c.fillRect(8, 8, 56, 140);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 3; i++) {
      c.fillStyle = ['#111', '#efe6cf', '#b3202a'][(i + j) % 3];
      c.fillRect(12 + i * 17, 14 + j * 22, 12, 18);
    }
    c.save();
    c.translate(80, 100);
    c.rotate(-Math.PI / 2);
    textFit(c, 'SLOP ENERGY', -60, -10, 120, 20, { family: F.block, color: '#c6f432' });
    c.restore();
  }, true);
  decal('iceBox', 160, 128, (c, w, h) => {
    fill(c, w, h, '#f4f6f8');
    c.fillStyle = '#1e88e5';
    c.fillRect(0, 0, w, 50);
    textFit(c, 'ICE', 10, 4, w - 20, 42, { family: F.sign, color: '#fff' });
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.fillRect(w / 2 - 1, 54, 2, h - 58);
    textFit(c, 'CRIME-FREE ZONE (MOSTLY)', 8, 100, w - 16, 18, { family: F.sans, weight: 800, color: '#333' });
  });
  decal('dumpster', 128, 96, (c, w, h) => {
    fill(c, w, h, '#2f5d3a');
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 1; i < 6; i++) c.fillRect((i * w) / 6, 0, 2, h);
    textFit(c, 'NO DUMPING (LOL)', 10, 36, w - 20, 22, { family: F.sans, weight: 900, color: '#e8e2c8' });
    grime(c, w, h, rngFor('dumpster'), 0.3);
  });
  decal('boardGame', 64, 48, (c, w, h) => {
    fill(c, w, h, '#fff');
    c.strokeStyle = '#d62828';
    c.lineWidth = 3;
    c.strokeRect(22, 22, 20, 16);
  });

  // --- banners
  const banner = (name: string, w: number, h: number, lines: string[], bg: string, fg: string, family: string = F.block) =>
    decal(name, w, h, (c, W, H) => {
      fill(c, W, H, bg);
      c.strokeStyle = fg;
      c.lineWidth = 3;
      c.strokeRect(5, 5, W - 10, H - 10);
      linesFit(c, lines, 14, 10, W - 28, H - 20, { family, color: fg });
    });
  banner('nowLeasing', 512, 112, ['NOW LEASING · LUXURY LIVING', 'FROM $2,995/MO · 1ST MONTH FREE*'], '#1d3557', '#f1faee');
  banner('forLease', 256, 96, ['FOR LEASE', '555-0199'], '#f4f1ea', '#b3202a');
  banner('grandOpening', 384, 96, ['GRAND OPENING!'], '#ffd400', '#b3202a');
  banner('closingSale', 384, 96, ['EVERYTHING MUST GO'], '#b3202a', '#ffffff');
  banner('nowHiring', 256, 96, ['NOW HIRING', '$9/HR + EXPOSURE'], '#ffffff', '#1d3a8a');
  banner('buildToRent', 384, 96, ['BUILD-TO-RENT COMMUNITY', 'BY BLACKRACK CAPITAL'], '#111111', '#ffffff');
  banner('hoaWarning', 256, 96, ['HOA VIOLATION', 'LAWN 2.1" > 2.0"'], '#ffffff', '#b3202a');
  banner('shovelReady', 384, 96, ['SHOVEL READY!', 'CALL CHAD 555-0142'], '#2e7d32', '#ffffff');
  banner('noTrespass', 256, 96, ['NO TRESPASSING', 'BEWARE OF WIFE'], '#b3202a', '#ffffff');
}

function fill2(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}

function garageDoor(c: Ctx, w: number, h: number, cols: number) {
  fill(c, w, h, '#efede6');
  const rows = 4;
  const pw = w / cols, ph = h / rows;
  for (let j = 0; j < rows; j++) {
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(0, j * ph, w, 2);
    for (let i = 0; i < cols; i++) {
      if (j === 0) {
        const g = c.createLinearGradient(0, 6, 0, ph - 6);
        g.addColorStop(0, '#6a7c88');
        g.addColorStop(1, '#27313a');
        c.fillStyle = g;
        c.fillRect(i * pw + 8, 8, pw - 16, ph - 16);
      } else {
        c.fillStyle = 'rgba(0,0,0,0.08)';
        c.fillRect(i * pw + 8, j * ph + 8, pw - 16, ph - 16);
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.fillRect(i * pw + 8, j * ph + 8, pw - 16, 2);
      }
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fillRect(0, h - 4, w, 4);
  grime(c, w, h, rngFor('garage' + cols), 0.08);
}

// Not used directly, re-exported for painters that need consistent lit colors.
export { litColor, win as paintWindow, mix };
