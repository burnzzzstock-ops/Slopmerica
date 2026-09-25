// Canvas-drawn mascots and brand icons. Every icon draws centered on (cx, cy)
// inside a box roughly s tall. Flat colors + fat ink outlines, sticker style.
import { Ctx, circle, ellipse, fillPoly, fillStroke, rr, star, bolt, drawText, F, stripes } from './draw';

const INK = '#111111';
const PINK = '#f7a8b8';
const PINK_D = '#e0748f';

// ------------------------------------------------------------------ pigs
export interface PigOpts {
  hair?: string; // blonde locks (Wigette)
  starShades?: boolean;
  wink?: boolean;
  cap?: string; // backwards cap color (Wiglet)
  beanie?: string;
  cig?: boolean;
  grin?: boolean;
  lashes?: boolean;
  lipstick?: boolean;
}

export function pigHead(c: Ctx, cx: number, cy: number, s: number, o: PigOpts = {}) {
  const r = s * 0.36;
  const lw = Math.max(1.5, s * 0.035);
  c.save();
  // hair behind head
  if (o.hair) {
    c.beginPath();
    c.moveTo(cx - r * 1.05, cy - r * 0.2);
    c.bezierCurveTo(cx - r * 1.5, cy + r * 0.6, cx - r * 1.2, cy + r * 1.25, cx - r * 0.7, cy + r * 1.05);
    c.lineTo(cx + r * 0.7, cy + r * 1.05);
    c.bezierCurveTo(cx + r * 1.25, cy + r * 1.25, cx + r * 1.5, cy + r * 0.6, cx + r * 1.05, cy - r * 0.2);
    c.closePath();
    fillStroke(c, o.hair, INK, lw);
  }
  // ears
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.moveTo(cx + sx * r * 0.35, cy - r * 0.8);
    c.lineTo(cx + sx * r * 1.05, cy - r * 1.25);
    c.lineTo(cx + sx * r * 0.95, cy - r * 0.35);
    c.closePath();
    fillStroke(c, PINK, INK, lw);
    c.beginPath();
    c.moveTo(cx + sx * r * 0.5, cy - r * 0.75);
    c.lineTo(cx + sx * r * 0.95, cy - r * 1.05);
    c.lineTo(cx + sx * r * 0.88, cy - r * 0.5);
    c.closePath();
    fillStroke(c, PINK_D);
  }
  // head
  ellipse(c, cx, cy, r * 1.08, r);
  fillStroke(c, PINK, INK, lw);
  // cheeks
  c.fillStyle = 'rgba(240,90,120,0.35)';
  circle(c, cx - r * 0.62, cy + r * 0.28, r * 0.2);
  c.fill();
  circle(c, cx + r * 0.62, cy + r * 0.28, r * 0.2);
  c.fill();
  // bangs
  if (o.hair) {
    c.beginPath();
    c.moveTo(cx - r * 1.02, cy - r * 0.15);
    c.bezierCurveTo(cx - r * 0.9, cy - r * 1.2, cx + r * 0.6, cy - r * 1.3, cx + r * 1.05, cy - r * 0.3);
    c.bezierCurveTo(cx + r * 0.6, cy - r * 0.55, cx + r * 0.2, cy - r * 0.4, cx - r * 0.1, cy - r * 0.75);
    c.bezierCurveTo(cx - r * 0.35, cy - r * 0.35, cx - r * 0.7, cy - r * 0.4, cx - r * 1.02, cy - r * 0.15);
    c.closePath();
    fillStroke(c, o.hair, INK, lw);
  }
  // beanie / cap
  if (o.beanie) {
    c.beginPath();
    c.moveTo(cx - r * 0.95, cy - r * 0.45);
    c.bezierCurveTo(cx - r * 0.9, cy - r * 1.45, cx + r * 0.9, cy - r * 1.45, cx + r * 0.95, cy - r * 0.45);
    c.closePath();
    fillStroke(c, o.beanie, INK, lw);
    rr(c, cx - r * 1.0, cy - r * 0.6, r * 2.0, r * 0.3, r * 0.1);
    fillStroke(c, o.beanie, INK, lw);
  }
  if (o.cap) {
    c.beginPath();
    c.moveTo(cx - r * 0.95, cy - r * 0.4);
    c.bezierCurveTo(cx - r * 0.95, cy - r * 1.35, cx + r * 0.95, cy - r * 1.35, cx + r * 0.95, cy - r * 0.4);
    c.closePath();
    fillStroke(c, o.cap, INK, lw);
    // brim pointing back-left
    ellipse(c, cx - r * 0.95, cy - r * 0.55, r * 0.45, r * 0.16, -0.3);
    fillStroke(c, o.cap, INK, lw);
  }
  // eyes
  const ey = cy - r * 0.18;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * r * 0.42;
    if (o.wink && sx === 1) {
      c.beginPath();
      c.arc(ex, ey + r * 0.05, r * 0.14, Math.PI * 1.1, Math.PI * 1.9);
      fillStroke(c, null, INK, lw * 1.2);
    } else {
      ellipse(c, ex, ey, r * 0.11, r * 0.15);
      fillStroke(c, INK);
      circle(c, ex + r * 0.04, ey - r * 0.05, r * 0.04);
      fillStroke(c, '#fff');
    }
    if (o.lashes) {
      c.strokeStyle = INK;
      c.lineWidth = lw * 0.8;
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + sx * (0.2 + k * 0.35);
        c.beginPath();
        c.moveTo(ex + Math.cos(a) * r * 0.14, ey + Math.sin(a) * r * 0.17);
        c.lineTo(ex + Math.cos(a) * r * 0.26, ey + Math.sin(a) * r * 0.28);
        c.stroke();
      }
    }
  }
  // star shades pushed up on the head
  if (o.starShades) {
    for (const sx of [-1, 1]) {
      star(c, cx + sx * r * 0.45, cy - r * 0.78, r * 0.3, r * 0.14, 5, -Math.PI / 2 + sx * 0.2);
      fillStroke(c, '#ff4fa3', INK, lw);
    }
    c.beginPath();
    c.moveTo(cx - r * 0.2, cy - r * 0.8);
    c.lineTo(cx + r * 0.2, cy - r * 0.8);
    fillStroke(c, null, INK, lw);
  }
  // snout
  ellipse(c, cx, cy + r * 0.25, r * 0.42, r * 0.3);
  fillStroke(c, PINK_D, INK, lw);
  ellipse(c, cx - r * 0.14, cy + r * 0.25, r * 0.07, r * 0.12);
  fillStroke(c, '#7a2a3e');
  ellipse(c, cx + r * 0.14, cy + r * 0.25, r * 0.07, r * 0.12);
  fillStroke(c, '#7a2a3e');
  // mouth
  c.beginPath();
  if (o.grin) {
    c.moveTo(cx - r * 0.38, cy + r * 0.6);
    c.quadraticCurveTo(cx, cy + r * 0.95, cx + r * 0.38, cy + r * 0.6);
    c.closePath();
    fillStroke(c, '#fff', INK, lw);
  } else {
    c.moveTo(cx - r * 0.3, cy + r * 0.62);
    c.quadraticCurveTo(cx + r * 0.05, cy + r * 0.85, cx + r * 0.36, cy + r * 0.58);
    fillStroke(c, null, o.lipstick ? '#d11a4a' : INK, lw * (o.lipstick ? 1.8 : 1.1));
  }
  if (o.cig) {
    c.save();
    c.translate(cx + r * 0.3, cy + r * 0.66);
    c.rotate(0.25);
    c.fillStyle = '#f4f1e8';
    c.fillRect(0, -r * 0.05, r * 0.5, r * 0.1);
    c.fillStyle = '#d9822b';
    c.fillRect(0, -r * 0.05, r * 0.12, r * 0.1);
    c.fillStyle = '#ff5a1f';
    c.fillRect(r * 0.47, -r * 0.05, r * 0.06, r * 0.1);
    c.restore();
    c.fillStyle = 'rgba(200,200,200,0.7)';
    circle(c, cx + r * 0.95, cy + r * 0.55, r * 0.09);
    c.fill();
    circle(c, cx + r * 1.05, cy + r * 0.35, r * 0.12);
    c.fill();
  }
  c.restore();
}

/** Wigette: blonde pig girl, star shades, wink. */
export function wigette(c: Ctx, cx: number, cy: number, s: number) {
  pigHead(c, cx, cy, s, { hair: '#f6d24a', starShades: true, wink: true, lashes: true, lipstick: true });
}

/** The Cannon Boys: two pig heads side by side (Wiglet wears the backwards cap). */
export function cannonBoys(c: Ctx, cx: number, cy: number, s: number) {
  pigHead(c, cx - s * 0.36, cy, s * 0.95, { cap: '#b3202a', grin: true });
  pigHead(c, cx + s * 0.36, cy, s * 0.95, { beanie: '#c6f432', cig: true });
}

// ------------------------------------------------------------------ cannon
export function cannon(c: Ctx, cx: number, cy: number, s: number, o: { smoke?: boolean; color?: string; flip?: boolean } = {}) {
  const lw = Math.max(1.5, s * 0.03);
  c.save();
  c.translate(cx, cy);
  if (o.flip) c.scale(-1, 1);
  const col = o.color ?? '#2a2a2a';
  // smoke
  if (o.smoke) {
    c.fillStyle = 'rgba(210,210,210,0.9)';
    const puffs = [[0.62, -0.42, 0.13], [0.74, -0.55, 0.16], [0.6, -0.62, 0.11], [0.86, -0.66, 0.12]];
    for (const [px, py, pr] of puffs) {
      circle(c, px * s, py * s, pr * s);
      fillStroke(c, '#d8d6cf', INK, lw * 0.7);
    }
  }
  // barrel
  c.save();
  c.translate(-s * 0.05, -s * 0.05);
  c.rotate(-0.38);
  c.beginPath();
  c.moveTo(-s * 0.36, -s * 0.13);
  c.lineTo(s * 0.46, -s * 0.08);
  c.lineTo(s * 0.46, s * 0.08);
  c.lineTo(-s * 0.36, s * 0.13);
  c.closePath();
  fillStroke(c, col, INK, lw);
  for (const rx of [-0.3, 0.05, 0.4]) {
    rr(c, rx * s, -s * 0.13, s * 0.06, s * 0.26, s * 0.02);
    fillStroke(c, '#caa24a', INK, lw * 0.8);
  }
  circle(c, -s * 0.42, 0, s * 0.08);
  fillStroke(c, col, INK, lw);
  rr(c, s * 0.44, -s * 0.11, s * 0.06, s * 0.22, s * 0.02);
  fillStroke(c, col, INK, lw);
  c.restore();
  // carriage
  fillPoly(c, [-s * 0.4, s * 0.12, s * 0.12, -s * 0.05, s * 0.2, s * 0.2, -s * 0.44, s * 0.24], '#7a4a24', INK, lw);
  // wheel
  circle(c, -s * 0.02, s * 0.2, s * 0.2);
  fillStroke(c, '#8a5a2c', INK, lw);
  c.strokeStyle = INK;
  c.lineWidth = lw * 0.8;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    c.beginPath();
    c.moveTo(-s * 0.02, s * 0.2);
    c.lineTo(-s * 0.02 + Math.cos(a) * s * 0.2, s * 0.2 + Math.sin(a) * s * 0.2);
    c.stroke();
  }
  circle(c, -s * 0.02, s * 0.2, s * 0.05);
  fillStroke(c, '#caa24a', INK, lw * 0.8);
  c.restore();
}

// ------------------------------------------------------------------ Fill Er Up guy
export function fillErUpGuy(c: Ctx, cx: number, cy: number, s: number, flag = true) {
  const lw = Math.max(1.5, s * 0.025);
  c.save();
  if (flag) {
    c.save();
    rr(c, cx - s * 0.6, cy - s * 0.4, s * 1.2, s * 0.8, s * 0.04);
    c.clip();
    stripes(c, cx - s * 0.6, cy - s * 0.4, s * 1.2, s * 0.8, ['#b3202a', '#f4efe2'], 13);
    c.fillStyle = '#1d3a8a';
    c.fillRect(cx - s * 0.6, cy - s * 0.4, s * 0.5, s * 0.43);
    c.fillStyle = '#fff';
    for (let i = 0; i < 12; i++) {
      star(c, cx - s * 0.54 + (i % 4) * s * 0.12, cy - s * 0.33 + Math.floor(i / 4) * s * 0.13, s * 0.03);
      c.fill();
    }
    c.restore();
  }
  // body (blue coat)
  fillPoly(c, [cx - s * 0.2, cy + s * 0.5, cx - s * 0.16, cy + s * 0.08, cx + s * 0.16, cy + s * 0.08, cx + s * 0.22, cy + s * 0.5], '#1d3a8a', INK, lw);
  // face
  circle(c, cx, cy - s * 0.04, s * 0.13);
  fillStroke(c, '#f2c9a0', INK, lw);
  // goatee
  fillPoly(c, [cx - s * 0.09, cy + s * 0.02, cx + s * 0.09, cy + s * 0.02, cx, cy + s * 0.2], '#f4f4f4', INK, lw);
  circle(c, cx - s * 0.045, cy - s * 0.07, s * 0.015);
  fillStroke(c, INK);
  circle(c, cx + s * 0.045, cy - s * 0.07, s * 0.015);
  fillStroke(c, INK);
  // top hat
  c.save();
  c.translate(cx, cy - s * 0.15);
  c.rotate(0.12);
  rr(c, -s * 0.2, -s * 0.03, s * 0.4, s * 0.06, s * 0.02);
  fillStroke(c, '#f4efe2', INK, lw);
  c.beginPath();
  c.rect(-s * 0.12, -s * 0.33, s * 0.24, s * 0.3);
  fillStroke(c, '#f4efe2', INK, lw);
  c.fillStyle = '#b3202a';
  for (let i = 0; i < 3; i++) c.fillRect(-s * 0.1 + i * s * 0.08, -s * 0.32, s * 0.04, s * 0.2);
  c.fillStyle = '#1d3a8a';
  c.fillRect(-s * 0.12, -s * 0.12, s * 0.24, s * 0.07);
  c.fillStyle = '#fff';
  star(c, 0, -s * 0.085, s * 0.03);
  c.fill();
  c.restore();
  // arm + nozzle
  c.strokeStyle = INK;
  c.lineWidth = s * 0.08;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx + s * 0.14, cy + s * 0.14);
  c.lineTo(cx + s * 0.32, cy + s * 0.22);
  c.stroke();
  c.strokeStyle = '#1d3a8a';
  c.lineWidth = s * 0.055;
  c.stroke();
  fillPoly(c, [cx + s * 0.3, cy + s * 0.16, cx + s * 0.46, cy + s * 0.18, cx + s * 0.52, cy + s * 0.26, cx + s * 0.44, cy + s * 0.28, cx + s * 0.3, cy + s * 0.28], '#c6f432', INK, lw);
  c.strokeStyle = INK;
  c.lineWidth = lw * 1.4;
  c.beginPath();
  c.moveTo(cx + s * 0.3, cy + s * 0.26);
  c.bezierCurveTo(cx + s * 0.1, cy + s * 0.5, cx + s * 0.5, cy + s * 0.55, cx + s * 0.58, cy + s * 0.5);
  c.stroke();
  c.restore();
}

// ------------------------------------------------------------------ Neural Fly
export function neuralFly(c: Ctx, cx: number, cy: number, s: number, neon = true) {
  const lw = Math.max(1.5, s * 0.025);
  c.save();
  if (neon) {
    c.shadowColor = '#ff2bd6';
    c.shadowBlur = s * 0.08;
  }
  // wings
  const wc = ['#34f5ff', '#ff2bd6'];
  for (const sx of [-1, 1]) {
    ellipse(c, cx + sx * s * 0.26, cy - s * 0.18, s * 0.26, s * 0.13, sx * -0.5);
    fillStroke(c, 'rgba(120,255,250,0.25)', wc[(sx + 1) / 2], lw * 1.5);
    c.strokeStyle = wc[(sx + 1) / 2];
    c.lineWidth = lw * 0.6;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.moveTo(cx + sx * s * 0.05, cy - s * 0.12);
      c.lineTo(cx + sx * s * (0.3 + k * 0.08), cy - s * (0.3 - k * 0.07));
      c.stroke();
    }
  }
  // legs
  c.strokeStyle = '#c6f432';
  c.lineWidth = lw;
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    c.beginPath();
    c.moveTo(cx + sx * s * 0.06, cy + s * (0.02 + k * 0.08));
    c.lineTo(cx + sx * s * 0.22, cy + s * (0.08 + k * 0.1));
    c.lineTo(cx + sx * s * 0.26, cy + s * (0.2 + k * 0.1));
    c.stroke();
  }
  // body segments
  const g = c.createLinearGradient(cx, cy - s * 0.2, cx, cy + s * 0.4);
  g.addColorStop(0, '#7a2bff');
  g.addColorStop(0.5, '#ff2bd6');
  g.addColorStop(1, '#ffb800');
  ellipse(c, cx, cy + s * 0.15, s * 0.1, s * 0.22);
  fillStroke(c, g, INK, lw);
  ellipse(c, cx, cy - s * 0.05, s * 0.11, s * 0.1);
  fillStroke(c, '#34f5ff', INK, lw);
  // compound eyes
  for (const sx of [-1, 1]) {
    const eg = c.createRadialGradient(cx + sx * s * 0.1, cy - s * 0.2, 0, cx + sx * s * 0.1, cy - s * 0.18, s * 0.1);
    eg.addColorStop(0, '#fffb00');
    eg.addColorStop(0.5, '#ff4b1f');
    eg.addColorStop(1, '#b3006b');
    circle(c, cx + sx * s * 0.1, cy - s * 0.18, s * 0.1);
    fillStroke(c, eg, INK, lw);
  }
  c.restore();
}

// ------------------------------------------------------------------ small icons
type IconFn = (c: Ctx, cx: number, cy: number, s: number) => void;

function lwOf(s: number) {
  return Math.max(1.5, s * 0.04);
}

export const ICONS: Record<string, IconFn> = {
  pig: (c, x, y, s) => pigHead(c, x, y, s, { grin: true }),
  wigette,
  cannonBoys,
  cannon: (c, x, y, s) => cannon(c, x, y, s, { smoke: true }),
  fly: (c, x, y, s) => neuralFly(c, x, y, s),
  uncleSam: (c, x, y, s) => fillErUpGuy(c, x, y, s, false),
  propane: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.2, y - s * 0.3, s * 0.4, s * 0.68, s * 0.18);
    fillStroke(c, '#f3f3f3', INK, lw);
    rr(c, x - s * 0.13, y - s * 0.44, s * 0.26, s * 0.16, s * 0.04);
    fillStroke(c, '#1d4fa3', INK, lw);
    c.fillStyle = '#1d4fa3';
    c.fillRect(x - s * 0.2, y - s * 0.02, s * 0.4, s * 0.1);
    ellipse(c, x, y - s * 0.46, s * 0.05, s * 0.03);
    fillStroke(c, '#caa24a', INK, lw * 0.6);
  },
  eightBalls: (c, x, y, s) => {
    for (const dx of [-0.2, 0.2]) {
      circle(c, x + dx * s, y, s * 0.24);
      fillStroke(c, INK, '#fff', lwOf(s) * 0.5);
      circle(c, x + dx * s - s * 0.03, y - s * 0.05, s * 0.1);
      fillStroke(c, '#fff');
      drawText(c, '8', x + dx * s - s * 0.03, y - s * 0.01, s * 0.14, { family: F.sans, weight: 900, align: 'center', color: INK });
    }
  },
  martini: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.3, y - s * 0.32, x + s * 0.3, y - s * 0.32, x, y + s * 0.02], 'rgba(200,240,255,0.9)', INK, lw);
    c.strokeStyle = INK;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(x, y + s * 0.02);
    c.lineTo(x, y + s * 0.34);
    c.moveTo(x - s * 0.15, y + s * 0.36);
    c.lineTo(x + s * 0.15, y + s * 0.36);
    c.stroke();
    circle(c, x + s * 0.08, y - s * 0.2, s * 0.07);
    fillStroke(c, '#6b8e23', INK, lw * 0.7);
    c.beginPath();
    c.moveTo(x + s * 0.08, y - s * 0.2);
    c.lineTo(x + s * 0.25, y - s * 0.44);
    fillStroke(c, null, INK, lw * 0.7);
  },
  peach: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x, y - s * 0.2);
    c.bezierCurveTo(x - s * 0.5, y - s * 0.45, x - s * 0.45, y + s * 0.4, x, y + s * 0.36);
    c.bezierCurveTo(x + s * 0.45, y + s * 0.4, x + s * 0.5, y - s * 0.45, x, y - s * 0.2);
    fillStroke(c, '#ff9a6b', INK, lw);
    c.beginPath();
    c.moveTo(x, y - s * 0.18);
    c.quadraticCurveTo(x - s * 0.08, y + s * 0.1, x, y + s * 0.34);
    fillStroke(c, null, '#d9534f', lw * 0.8);
    ellipse(c, x + s * 0.14, y - s * 0.3, s * 0.13, s * 0.06, -0.5);
    fillStroke(c, '#4caf50', INK, lw * 0.7);
  },
  strawberry: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.3, y - s * 0.18);
    c.bezierCurveTo(x - s * 0.35, y + s * 0.15, x - s * 0.1, y + s * 0.38, x, y + s * 0.4);
    c.bezierCurveTo(x + s * 0.1, y + s * 0.38, x + s * 0.35, y + s * 0.15, x + s * 0.3, y - s * 0.18);
    c.quadraticCurveTo(x, y - s * 0.3, x - s * 0.3, y - s * 0.18);
    fillStroke(c, '#e0233a', INK, lw);
    c.fillStyle = '#ffe066';
    for (let i = 0; i < 9; i++) {
      ellipse(c, x + (((i * 37) % 7) - 3) * s * 0.06, y - s * 0.08 + Math.floor(i / 3) * s * 0.13, s * 0.015, s * 0.028);
      c.fill();
    }
    star(c, x, y - s * 0.22, s * 0.18, s * 0.07, 6);
    fillStroke(c, '#3fa34d', INK, lw * 0.7);
  },
  cherryBomb: (c, x, y, s) => {
    const lw = lwOf(s);
    for (const dx of [-0.16, 0.16]) {
      circle(c, x + dx * s, y + s * 0.16, s * 0.17);
      fillStroke(c, '#c1121f', INK, lw);
      circle(c, x + dx * s - s * 0.05, y + s * 0.1, s * 0.04);
      fillStroke(c, 'rgba(255,255,255,0.8)');
    }
    c.beginPath();
    c.moveTo(x - s * 0.16, y);
    c.quadraticCurveTo(x - s * 0.05, y - s * 0.3, x + s * 0.05, y - s * 0.34);
    c.moveTo(x + s * 0.16, y);
    c.quadraticCurveTo(x + s * 0.1, y - s * 0.2, x + s * 0.05, y - s * 0.34);
    fillStroke(c, null, '#3a5a1a', lw);
    star(c, x + s * 0.07, y - s * 0.38, s * 0.12, s * 0.05, 8);
    fillStroke(c, '#ffd400', '#ff6a00', lw * 0.6);
  },
  armadillo: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.42, y + s * 0.18);
    c.quadraticCurveTo(x - s * 0.55, y + s * 0.3, x - s * 0.62, y + s * 0.15);
    fillStroke(c, null, INK, lw * 1.6);
    c.beginPath();
    c.ellipse(x - s * 0.05, y + s * 0.1, s * 0.4, s * 0.3, 0, Math.PI, 0);
    c.closePath();
    fillStroke(c, '#b5835a', INK, lw);
    c.strokeStyle = INK;
    c.lineWidth = lw * 0.7;
    for (let k = -2; k <= 2; k++) {
      c.beginPath();
      c.moveTo(x - s * 0.05 + k * s * 0.12, y + s * 0.1);
      c.quadraticCurveTo(x - s * 0.05 + k * s * 0.1, y - s * 0.12, x - s * 0.05 + k * s * 0.08, y - s * 0.18);
      c.stroke();
    }
    fillPoly(c, [x + s * 0.3, y - s * 0.02, x + s * 0.58, y + s * 0.1, x + s * 0.3, y + s * 0.14], '#d9a77a', INK, lw);
    ellipse(c, x + s * 0.34, y - s * 0.08, s * 0.05, s * 0.1, 0.4);
    fillStroke(c, '#d9a77a', INK, lw * 0.7);
    circle(c, x + s * 0.4, y + s * 0.05, s * 0.02);
    fillStroke(c, INK);
    for (const lx of [-0.3, 0.15]) {
      c.fillStyle = '#b5835a';
      c.fillRect(x + lx * s, y + s * 0.1, s * 0.08, s * 0.12);
      c.strokeRect(x + lx * s, y + s * 0.1, s * 0.08, s * 0.12);
    }
    // cowboy hat
    ellipse(c, x + s * 0.34, y - s * 0.14, s * 0.14, s * 0.035, 0.2);
    fillStroke(c, '#6b3e1f', INK, lw * 0.6);
    rr(c, x + s * 0.28, y - s * 0.26, s * 0.12, s * 0.11, s * 0.03);
    fillStroke(c, '#6b3e1f', INK, lw * 0.6);
  },
  possum: (c, x, y, s) => {
    const lw = lwOf(s);
    for (const sx of [-1, 1]) {
      circle(c, x + sx * s * 0.22, y - s * 0.2, s * 0.1);
      fillStroke(c, '#2a2a2a', INK, lw);
      circle(c, x + sx * s * 0.22, y - s * 0.2, s * 0.05);
      fillStroke(c, '#f7a8b8');
    }
    c.beginPath();
    c.moveTo(x - s * 0.28, y - s * 0.1);
    c.quadraticCurveTo(x, y - s * 0.35, x + s * 0.28, y - s * 0.1);
    c.quadraticCurveTo(x + s * 0.2, y + s * 0.2, x, y + s * 0.34);
    c.quadraticCurveTo(x - s * 0.2, y + s * 0.2, x - s * 0.28, y - s * 0.1);
    fillStroke(c, '#e9e6e0', INK, lw);
    circle(c, x, y + s * 0.33, s * 0.05);
    fillStroke(c, '#f07a98', INK, lw * 0.6);
    for (const sx of [-1, 1]) {
      circle(c, x + sx * s * 0.1, y - s * 0.02, s * 0.05);
      fillStroke(c, INK);
    }
    // trucker cap
    c.beginPath();
    c.moveTo(x - s * 0.26, y - s * 0.16);
    c.quadraticCurveTo(x, y - s * 0.46, x + s * 0.26, y - s * 0.16);
    c.closePath();
    fillStroke(c, '#e8e8e8', INK, lw);
    c.fillStyle = '#c1121f';
    c.fillRect(x - s * 0.1, y - s * 0.3, s * 0.2, s * 0.08);
    ellipse(c, x, y - s * 0.15, s * 0.3, s * 0.05);
    fillStroke(c, '#c1121f', INK, lw * 0.7);
  },
  chicken: (c, x, y, s) => {
    const lw = lwOf(s);
    // maple leaf
    c.beginPath();
    const P = [0, -0.45, 0.08, -0.3, 0.2, -0.36, 0.16, -0.12, 0.38, -0.22, 0.32, -0.02, 0.42, 0.04, 0.2, 0.16, 0.22, 0.26, 0.04, 0.2, 0.03, 0.42, -0.03, 0.42, -0.04, 0.2, -0.22, 0.26, -0.2, 0.16, -0.42, 0.04, -0.32, -0.02, -0.38, -0.22, -0.16, -0.12, -0.2, -0.36, -0.08, -0.3];
    for (let i = 0; i < P.length; i += 2) i ? c.lineTo(x + P[i] * s, y + P[i + 1] * s) : c.moveTo(x + P[i] * s, y + P[i + 1] * s);
    c.closePath();
    fillStroke(c, '#d71920', INK, lw * 0.7);
    // chicken head
    c.beginPath();
    c.moveTo(x - s * 0.08, y + s * 0.12);
    c.quadraticCurveTo(x - s * 0.14, y - s * 0.15, x + s * 0.02, y - s * 0.16);
    c.quadraticCurveTo(x + s * 0.14, y - s * 0.12, x + s * 0.1, y + s * 0.12);
    c.closePath();
    fillStroke(c, '#fff', INK, lw * 0.6);
    fillPoly(c, [x - s * 0.04, y - s * 0.16, x, y - s * 0.26, x + s * 0.04, y - s * 0.19, x + s * 0.08, y - s * 0.24, x + s * 0.08, y - s * 0.14], '#ffcc00', INK, lw * 0.5);
    fillPoly(c, [x + s * 0.1, y - s * 0.07, x + s * 0.2, y - s * 0.04, x + s * 0.1, y - s * 0.01], '#ffb000', INK, lw * 0.5);
    circle(c, x + s * 0.04, y - s * 0.08, s * 0.015);
    fillStroke(c, INK);
  },
  burger: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.ellipse(x, y, s * 0.36, s * 0.26, 0, Math.PI, 0);
    c.closePath();
    fillStroke(c, '#e0a458', INK, lw);
    rr(c, x - s * 0.38, y, s * 0.76, s * 0.07, s * 0.03);
    fillStroke(c, '#5aa02c', INK, lw * 0.7);
    rr(c, x - s * 0.36, y + s * 0.07, s * 0.72, s * 0.1, s * 0.04);
    fillStroke(c, '#6b3a1f', INK, lw * 0.7);
    rr(c, x - s * 0.36, y + s * 0.17, s * 0.72, s * 0.12, s * 0.06);
    fillStroke(c, '#e0a458', INK, lw);
    c.fillStyle = '#fff4d6';
    for (let i = 0; i < 6; i++) {
      ellipse(c, x - s * 0.2 + i * s * 0.08, y - s * 0.12 - (i % 2) * s * 0.05, s * 0.018, s * 0.01);
      c.fill();
    }
  },
  crown: (c, x, y, s) => {
    fillPoly(c, [x - s * 0.36, y + s * 0.22, x - s * 0.4, y - s * 0.2, x - s * 0.18, y, x, y - s * 0.3, x + s * 0.18, y, x + s * 0.4, y - s * 0.2, x + s * 0.36, y + s * 0.22], '#ffcc00', INK, lwOf(s));
    for (const dx of [-0.2, 0, 0.2]) {
      circle(c, x + dx * s, y + s * 0.12, s * 0.04);
      fillStroke(c, '#d7263d');
    }
  },
  bull: (c, x, y, s) => {
    const lw = lwOf(s);
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.moveTo(x + sx * s * 0.15, y - s * 0.12);
      c.quadraticCurveTo(x + sx * s * 0.45, y - s * 0.12, x + sx * s * 0.42, y - s * 0.38);
      c.quadraticCurveTo(x + sx * s * 0.34, y - s * 0.2, x + sx * s * 0.12, y - s * 0.22);
      fillStroke(c, '#f5ecd7', INK, lw);
    }
    // taco shell as the face
    c.beginPath();
    c.ellipse(x, y + s * 0.02, s * 0.3, s * 0.3, 0, Math.PI * 0.05, Math.PI * 0.95);
    c.closePath();
    fillStroke(c, '#f2b134', INK, lw);
    c.beginPath();
    c.ellipse(x, y + s * 0.04, s * 0.26, s * 0.1, 0, Math.PI, 0);
    fillStroke(c, '#4caf50', INK, lw * 0.6);
    for (const sx of [-1, 1]) {
      circle(c, x + sx * s * 0.1, y + s * 0.14, s * 0.035);
      fillStroke(c, INK);
    }
    circle(c, x, y + s * 0.26, s * 0.06);
    fillStroke(c, null, '#caa24a', lw);
  },
  owl: (c, x, y, s) => {
    const lw = lwOf(s);
    ellipse(c, x, y + s * 0.05, s * 0.3, s * 0.36);
    fillStroke(c, '#c26a2a', INK, lw);
    fillPoly(c, [x - s * 0.28, y - s * 0.2, x - s * 0.22, y - s * 0.42, x - s * 0.08, y - s * 0.26], '#c26a2a', INK, lw);
    fillPoly(c, [x + s * 0.28, y - s * 0.2, x + s * 0.22, y - s * 0.42, x + s * 0.08, y - s * 0.26], '#c26a2a', INK, lw);
    for (const sx of [-1, 1]) {
      circle(c, x + sx * s * 0.13, y - s * 0.08, s * 0.12);
      fillStroke(c, '#fff', INK, lw);
      circle(c, x + sx * s * 0.11, y - s * 0.07, s * 0.05);
      fillStroke(c, INK);
    }
    fillPoly(c, [x - s * 0.05, y + s * 0.04, x + s * 0.05, y + s * 0.04, x, y + s * 0.14], '#ffb000', INK, lw * 0.6);
  },
  coffeeEye: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.24, y - s * 0.2, x + s * 0.24, y - s * 0.2, x + s * 0.18, y + s * 0.34, x - s * 0.18, y + s * 0.34], '#f5ecd7', INK, lw);
    rr(c, x - s * 0.28, y - s * 0.3, s * 0.56, s * 0.1, s * 0.03);
    fillStroke(c, '#3b2416', INK, lw);
    ellipse(c, x, y + s * 0.07, s * 0.14, s * 0.08);
    fillStroke(c, '#fff', INK, lw * 0.8);
    circle(c, x, y + s * 0.07, s * 0.05);
    fillStroke(c, '#1b9e77', INK, lw * 0.5);
    circle(c, x, y + s * 0.07, s * 0.02);
    fillStroke(c, INK);
    c.strokeStyle = '#999';
    c.lineWidth = lw * 0.7;
    for (const dx of [-0.08, 0.06]) {
      c.beginPath();
      c.moveTo(x + dx * s, y - s * 0.34);
      c.bezierCurveTo(x + dx * s - s * 0.06, y - s * 0.4, x + dx * s + s * 0.06, y - s * 0.44, x + dx * s, y - s * 0.5);
      c.stroke();
    }
  },
  soy: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.3, y + s * 0.25);
    c.bezierCurveTo(x - s * 0.35, y - s * 0.1, x + s * 0.05, y - s * 0.45, x + s * 0.32, y - s * 0.3);
    c.bezierCurveTo(x + s * 0.25, y + s * 0.05, x - s * 0.05, y + s * 0.3, x - s * 0.3, y + s * 0.25);
    fillStroke(c, '#8bc34a', INK, lw);
    for (let i = 0; i < 3; i++) {
      circle(c, x - s * 0.14 + i * s * 0.13, y + s * 0.08 - i * s * 0.12, s * 0.06);
      fillStroke(c, '#d4e157', INK, lw * 0.5);
    }
  },
  flag: (c, x, y, s) => {
    c.save();
    c.beginPath();
    c.rect(x - s * 0.45, y - s * 0.3, s * 0.9, s * 0.6);
    c.clip();
    stripes(c, x - s * 0.45, y - s * 0.3, s * 0.9, s * 0.6, ['#b3202a', '#f4efe2'], 13);
    c.fillStyle = '#1d3a8a';
    c.fillRect(x - s * 0.45, y - s * 0.3, s * 0.38, s * 0.32);
    c.fillStyle = '#fff';
    for (let i = 0; i < 12; i++) {
      star(c, x - s * 0.4 + (i % 4) * s * 0.095, y - s * 0.25 + Math.floor(i / 4) * s * 0.1, s * 0.025);
      c.fill();
    }
    c.restore();
    c.strokeStyle = INK;
    c.lineWidth = lwOf(s) * 0.6;
    c.strokeRect(x - s * 0.45, y - s * 0.3, s * 0.9, s * 0.6);
  },
  eagle: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.3, y + s * 0.35);
    c.quadraticCurveTo(x - s * 0.35, y - s * 0.1, x - s * 0.05, y - s * 0.3);
    c.quadraticCurveTo(x + s * 0.2, y - s * 0.38, x + s * 0.3, y - s * 0.18);
    c.lineTo(x + s * 0.1, y - s * 0.08);
    c.quadraticCurveTo(x + s * 0.02, y + s * 0.2, x + s * 0.1, y + s * 0.35);
    c.closePath();
    fillStroke(c, '#fff', INK, lw);
    fillPoly(c, [x + s * 0.22, y - s * 0.24, x + s * 0.44, y - s * 0.16, x + s * 0.28, y - s * 0.06, x + s * 0.18, y - s * 0.12], '#ffb000', INK, lw);
    circle(c, x + s * 0.12, y - s * 0.2, s * 0.03);
    fillStroke(c, INK);
    c.beginPath();
    c.moveTo(x + s * 0.03, y - s * 0.26);
    c.lineTo(x + s * 0.2, y - s * 0.24);
    fillStroke(c, null, INK, lw * 1.2);
  },
  fireworks: (c, x, y, s) => {
    const cols = ['#ff3b3b', '#ffd400', '#3bd1ff', '#ffffff'];
    c.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const bx = x + [-0.18, 0.2, 0][b] * s, by = y + [-0.1, -0.15, 0.18][b] * s, br = [0.22, 0.18, 0.2][b] * s;
      c.strokeStyle = cols[b];
      c.lineWidth = Math.max(1.5, s * 0.03);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        c.beginPath();
        c.moveTo(bx + Math.cos(a) * br * 0.3, by + Math.sin(a) * br * 0.3);
        c.lineTo(bx + Math.cos(a) * br, by + Math.sin(a) * br);
        c.stroke();
      }
    }
  },
  coin: (c, x, y, s) => {
    const lw = lwOf(s);
    circle(c, x, y, s * 0.36);
    fillStroke(c, '#f5b300', INK, lw);
    circle(c, x, y, s * 0.28);
    fillStroke(c, null, '#b37d00', lw * 0.7);
    // corn cob
    ellipse(c, x, y, s * 0.09, s * 0.2);
    fillStroke(c, '#ffe14d', INK, lw * 0.6);
    c.fillStyle = '#d4a300';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      circle(c, x - s * 0.03 + j * s * 0.06, y - s * 0.13 + i * s * 0.065, s * 0.012);
      c.fill();
    }
    fillPoly(c, [x - s * 0.02, y + s * 0.2, x - s * 0.16, y + s * 0.05, x - s * 0.05, y + s * 0.1], '#5aa02c', INK, lw * 0.5);
  },
  cross: (c, x, y, s) => {
    fillPoly(c, [x - s * 0.06, y - s * 0.4, x + s * 0.06, y - s * 0.4, x + s * 0.06, y - s * 0.18, x + s * 0.24, y - s * 0.18, x + s * 0.24, y - s * 0.06, x + s * 0.06, y - s * 0.06, x + s * 0.06, y + s * 0.4, x - s * 0.06, y + s * 0.4, x - s * 0.06, y - s * 0.06, x - s * 0.24, y - s * 0.06, x - s * 0.24, y - s * 0.18, x - s * 0.06, y - s * 0.18], '#fff8e1', INK, lwOf(s) * 0.7);
  },
  flame: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x, y + s * 0.4);
    c.bezierCurveTo(x - s * 0.35, y + s * 0.35, x - s * 0.3, y - s * 0.05, x - s * 0.1, y - s * 0.2);
    c.quadraticCurveTo(x - s * 0.08, y - s * 0.05, x, y - s * 0.02);
    c.quadraticCurveTo(x - s * 0.05, y - s * 0.3, x + s * 0.08, y - s * 0.44);
    c.bezierCurveTo(x + s * 0.12, y - s * 0.2, x + s * 0.4, y, x + s * 0.28, y + s * 0.28);
    c.quadraticCurveTo(x + s * 0.2, y + s * 0.4, x, y + s * 0.4);
    fillStroke(c, '#ff5a1f', INK, lw);
    c.beginPath();
    c.moveTo(x, y + s * 0.34);
    c.bezierCurveTo(x - s * 0.16, y + s * 0.3, x - s * 0.12, y + s * 0.1, x, y + s * 0.02);
    c.bezierCurveTo(x + s * 0.12, y + s * 0.12, x + s * 0.18, y + s * 0.3, x, y + s * 0.34);
    fillStroke(c, '#ffd400');
  },
  smoke: (c, x, y, s) => {
    const lw = lwOf(s);
    const puffs = [[0, 0.22, 0.18], [-0.14, 0.02, 0.15], [0.12, -0.08, 0.16], [-0.04, -0.26, 0.13], [0.16, -0.34, 0.09]];
    for (const [px, py, pr] of puffs) {
      circle(c, x + px * s, y + py * s, pr * s);
      fillStroke(c, '#e9e6de', INK, lw * 0.8);
    }
  },
  cloud: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.arc(x - s * 0.18, y + s * 0.05, s * 0.16, Math.PI * 0.5, Math.PI * 1.5);
    c.arc(x, y - s * 0.08, s * 0.2, Math.PI, Math.PI * 2);
    c.arc(x + s * 0.2, y + s * 0.05, s * 0.16, Math.PI * 1.5, Math.PI * 0.5);
    c.closePath();
    fillStroke(c, '#e6f7ff', INK, lw);
  },
  chip: (c, x, y, s) => {
    const lw = lwOf(s);
    c.strokeStyle = INK;
    c.lineWidth = lw;
    for (let k = 0; k < 4; k++) {
      const o = -0.18 + k * 0.12;
      c.beginPath();
      c.moveTo(x + o * s, y - s * 0.4);
      c.lineTo(x + o * s, y + s * 0.4);
      c.moveTo(x - s * 0.4, y + o * s);
      c.lineTo(x + s * 0.4, y + o * s);
      c.stroke();
    }
    rr(c, x - s * 0.28, y - s * 0.28, s * 0.56, s * 0.56, s * 0.06);
    fillStroke(c, '#222', INK, lw);
    drawText(c, 'AI', x, y + s * 0.1, s * 0.3, { family: F.sign, align: 'center', color: '#c6f432' });
  },
  hand7: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.2, y - s * 0.02, s * 0.4, s * 0.36, s * 0.12);
    fillStroke(c, '#f2c9a0', INK, lw);
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * 0.95 + (k / 6) * Math.PI * 0.9;
      c.save();
      c.translate(x + Math.cos(a) * s * 0.14, y + s * 0.02 + Math.sin(a) * s * 0.12);
      c.rotate(a + Math.PI / 2);
      rr(c, -s * 0.035, -s * 0.28, s * 0.07, s * 0.28, s * 0.035);
      fillStroke(c, '#f2c9a0', INK, lw * 0.7);
      c.restore();
    }
  },
  tireIron: (c, x, y, s) => {
    c.save();
    c.translate(x, y);
    c.rotate(-0.6);
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.lineWidth = s * 0.12;
    c.beginPath();
    c.moveTo(-s * 0.4, 0);
    c.lineTo(s * 0.4, 0);
    c.moveTo(0, -s * 0.4);
    c.lineTo(0, s * 0.4);
    c.stroke();
    c.strokeStyle = '#b0b7bf';
    c.lineWidth = s * 0.07;
    c.stroke();
    c.restore();
  },
  mattress: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.42, y - s * 0.1, s * 0.84, s * 0.26, s * 0.08);
    fillStroke(c, '#e8f0ff', INK, lw);
    c.strokeStyle = '#8aa4d6';
    c.lineWidth = lw * 0.6;
    for (let k = 1; k < 6; k++) {
      c.beginPath();
      c.moveTo(x - s * 0.42 + k * s * 0.14, y - s * 0.08);
      c.lineTo(x - s * 0.42 + k * s * 0.14, y + s * 0.14);
      c.stroke();
    }
    ICONS.crown(c, x, y - s * 0.28, s * 0.5);
  },
  dollar: (c, x, y, s) => {
    circle(c, x, y, s * 0.38);
    fillStroke(c, '#2e7d32', INK, lwOf(s));
    drawText(c, '$', x, y + s * 0.2, s * 0.56, { family: F.sign, align: 'center', color: '#fff' });
  },
  moneyBag: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.1, y - s * 0.22);
    c.bezierCurveTo(x - s * 0.45, y, x - s * 0.4, y + s * 0.4, x, y + s * 0.4);
    c.bezierCurveTo(x + s * 0.4, y + s * 0.4, x + s * 0.45, y, x + s * 0.1, y - s * 0.22);
    c.closePath();
    fillStroke(c, '#c8a96a', INK, lw);
    fillPoly(c, [x - s * 0.14, y - s * 0.4, x + s * 0.14, y - s * 0.4, x + s * 0.08, y - s * 0.22, x - s * 0.08, y - s * 0.22], '#c8a96a', INK, lw);
    drawText(c, '$', x, y + s * 0.26, s * 0.36, { family: F.sign, align: 'center', color: '#2e7d32' });
  },
  hammer: (c, x, y, s) => {
    c.save();
    c.translate(x, y);
    c.rotate(0.6);
    rr(c, -s * 0.05, -s * 0.2, s * 0.1, s * 0.6, s * 0.03);
    fillStroke(c, '#c68642', INK, lwOf(s));
    rr(c, -s * 0.25, -s * 0.34, s * 0.5, s * 0.16, s * 0.03);
    fillStroke(c, '#90a4ae', INK, lwOf(s));
    c.restore();
  },
  target: (c, x, y, s) => {
    for (let k = 0; k < 3; k++) {
      circle(c, x, y, s * (0.38 - k * 0.13));
      fillStroke(c, k % 2 ? '#fff' : '#cc0000');
    }
  },
  tractor: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.3, y - s * 0.1, s * 0.5, s * 0.2, s * 0.03);
    fillStroke(c, '#2e7d32', INK, lw);
    rr(c, x - s * 0.18, y - s * 0.34, s * 0.2, s * 0.25, s * 0.03);
    fillStroke(c, '#2e7d32', INK, lw);
    circle(c, x - s * 0.22, y + s * 0.18, s * 0.2);
    fillStroke(c, '#222', INK, lw);
    circle(c, x - s * 0.22, y + s * 0.18, s * 0.09);
    fillStroke(c, '#ffd400', INK, lw * 0.5);
    circle(c, x + s * 0.24, y + s * 0.24, s * 0.12);
    fillStroke(c, '#222', INK, lw);
    circle(c, x + s * 0.24, y + s * 0.24, s * 0.05);
    fillStroke(c, '#ffd400');
  },
  fish: (c, x, y, s) => {
    const lw = lwOf(s);
    ellipse(c, x - s * 0.04, y, s * 0.3, s * 0.16);
    fillStroke(c, '#6b8e23', INK, lw);
    fillPoly(c, [x + s * 0.22, y, x + s * 0.42, y - s * 0.16, x + s * 0.42, y + s * 0.16], '#6b8e23', INK, lw);
    circle(c, x - s * 0.2, y - s * 0.04, s * 0.03);
    fillStroke(c, INK);
    c.beginPath();
    c.moveTo(x - s * 0.34, y + s * 0.02);
    c.lineTo(x - s * 0.24, y + s * 0.06);
    fillStroke(c, null, INK, lw);
  },
  bottle: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.05, y - s * 0.42, x + s * 0.05, y - s * 0.42, x + s * 0.05, y - s * 0.2, x + s * 0.14, y - s * 0.1, x + s * 0.14, y + s * 0.4, x - s * 0.14, y + s * 0.4, x - s * 0.14, y - s * 0.1, x - s * 0.05, y - s * 0.2], '#7a4a1a', INK, lw);
    rr(c, x - s * 0.12, y + s * 0.02, s * 0.24, s * 0.2, s * 0.02);
    fillStroke(c, '#f5ecd7', INK, lw * 0.5);
    drawText(c, 'XXX', x, y + s * 0.16, s * 0.1, { family: F.sign, align: 'center', color: INK });
  },
  cicada: (c, x, y, s) => {
    const lw = lwOf(s);
    for (const sx of [-1, 1]) {
      ellipse(c, x + sx * s * 0.16, y + s * 0.02, s * 0.12, s * 0.32, sx * 0.3);
      fillStroke(c, 'rgba(180,255,240,0.6)', INK, lw * 0.7);
    }
    ellipse(c, x, y, s * 0.1, s * 0.3);
    fillStroke(c, '#556b2f', INK, lw);
    for (const sx of [-1, 1]) {
      circle(c, x + sx * s * 0.08, y - s * 0.26, s * 0.05);
      fillStroke(c, '#d7263d', INK, lw * 0.5);
    }
    c.strokeStyle = '#3bd1ff';
    c.lineWidth = lw * 0.8;
    for (let k = 1; k <= 2; k++) {
      c.beginPath();
      c.arc(x, y - s * 0.3, s * 0.12 * k + s * 0.08, -Math.PI * 0.8, -Math.PI * 0.2);
      c.stroke();
    }
  },
  torch: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.12, y - s * 0.12, x + s * 0.12, y - s * 0.12, x + s * 0.05, y + s * 0.42, x - s * 0.05, y + s * 0.42], '#4db6ac', INK, lw);
    rr(c, x - s * 0.16, y - s * 0.18, s * 0.32, s * 0.08, s * 0.02);
    fillStroke(c, '#4db6ac', INK, lw);
    ICONS.flame(c, x, y - s * 0.34, s * 0.4);
  },
  pumpkin: (c, x, y, s) => {
    const lw = lwOf(s);
    for (const dx of [-0.16, 0.16, 0]) {
      ellipse(c, x + dx * s, y + s * 0.05, s * 0.2, s * 0.28);
      fillStroke(c, '#ff7518', INK, lw);
    }
    rr(c, x - s * 0.03, y - s * 0.34, s * 0.06, s * 0.14, s * 0.02);
    fillStroke(c, '#4e6b1f', INK, lw * 0.6);
    fillPoly(c, [x - s * 0.16, y - s * 0.02, x - s * 0.06, y - s * 0.02, x - s * 0.11, y - s * 0.1], INK);
    fillPoly(c, [x + s * 0.16, y - s * 0.02, x + s * 0.06, y - s * 0.02, x + s * 0.11, y - s * 0.1], INK);
    fillPoly(c, [x - s * 0.18, y + s * 0.1, x + s * 0.18, y + s * 0.1, x + s * 0.1, y + s * 0.2, x, y + s * 0.14, x - s * 0.1, y + s * 0.2], INK);
  },
  box: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.36, y - s * 0.12, x + s * 0.36, y - s * 0.12, x + s * 0.36, y + s * 0.34, x - s * 0.36, y + s * 0.34], '#c8a26a', INK, lw);
    fillPoly(c, [x - s * 0.36, y - s * 0.12, x - s * 0.24, y - s * 0.32, x + s * 0.24, y - s * 0.32, x + s * 0.36, y - s * 0.12], '#d9b47a', INK, lw);
    c.beginPath();
    c.moveTo(x - s * 0.24, y + s * 0.1);
    c.quadraticCurveTo(x, y + s * 0.26, x + s * 0.2, y + s * 0.06);
    fillStroke(c, null, '#111', lw * 1.3);
    fillPoly(c, [x + s * 0.2, y + s * 0.06, x + s * 0.24, y + s * 0.16, x + s * 0.12, y + s * 0.12], '#111');
  },
  shield: (c, x, y, s) => {
    c.beginPath();
    c.moveTo(x, y - s * 0.4);
    c.lineTo(x + s * 0.32, y - s * 0.28);
    c.quadraticCurveTo(x + s * 0.3, y + s * 0.2, x, y + s * 0.4);
    c.quadraticCurveTo(x - s * 0.3, y + s * 0.2, x - s * 0.32, y - s * 0.28);
    c.closePath();
    fillStroke(c, '#1d3a8a', INK, lwOf(s));
    star(c, x, y - s * 0.02, s * 0.18);
    fillStroke(c, '#fff');
  },
  truck: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.42, y - s * 0.02, s * 0.84, s * 0.2, s * 0.04);
    fillStroke(c, '#2b2b2b', INK, lw);
    fillPoly(c, [x - s * 0.1, y - s * 0.02, x - s * 0.02, y - s * 0.22, x + s * 0.24, y - s * 0.22, x + s * 0.32, y - s * 0.02], '#2b2b2b', INK, lw);
    for (const wx of [-0.26, 0.26]) {
      circle(c, x + wx * s, y + s * 0.2, s * 0.13);
      fillStroke(c, '#111', '#555', lw);
    }
    c.fillStyle = 'rgba(40,40,40,0.8)';
    for (let k = 0; k < 3; k++) {
      circle(c, x - s * 0.5 - k * s * 0.08, y - s * 0.15 - k * s * 0.06, s * (0.06 + k * 0.03));
      c.fill();
    }
  },
  house: (c, x, y, s) => {
    const lw = lwOf(s);
    fillPoly(c, [x - s * 0.3, y, x + s * 0.3, y, x + s * 0.3, y + s * 0.34, x - s * 0.3, y + s * 0.34], '#f5ecd7', INK, lw);
    fillPoly(c, [x - s * 0.4, y + s * 0.02, x, y - s * 0.34, x + s * 0.4, y + s * 0.02], '#b3202a', INK, lw);
    c.fillStyle = '#6b3a1f';
    c.fillRect(x - s * 0.06, y + s * 0.14, s * 0.12, s * 0.2);
  },
  palm: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.04, y + s * 0.42);
    c.quadraticCurveTo(x + s * 0.05, y, x - s * 0.02, y - s * 0.24);
    fillStroke(c, null, '#8d6e63', s * 0.07);
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI + (k / 4) * Math.PI;
      c.beginPath();
      c.moveTo(x - s * 0.02, y - s * 0.24);
      c.quadraticCurveTo(x + Math.cos(a) * s * 0.2, y - s * 0.4, x + Math.cos(a) * s * 0.38, y - s * 0.24 + Math.abs(Math.sin(a)) * -s * 0.02 + s * 0.08);
      fillStroke(c, null, '#2e8b57', lw * 1.6);
    }
  },
  donut: (c, x, y, s) => {
    circle(c, x, y, s * 0.36);
    fillStroke(c, '#d9a066', INK, lwOf(s));
    circle(c, x, y, s * 0.3);
    fillStroke(c, '#ff6fae');
    circle(c, x, y, s * 0.1);
    fillStroke(c, '#fff', INK, lwOf(s));
  },
  skull: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.arc(x, y - s * 0.05, s * 0.3, Math.PI * 0.85, Math.PI * 2.15);
    c.lineTo(x + s * 0.16, y + s * 0.34);
    c.lineTo(x - s * 0.16, y + s * 0.34);
    c.closePath();
    fillStroke(c, '#f5f5f5', INK, lw);
    circle(c, x - s * 0.11, y - s * 0.03, s * 0.08);
    fillStroke(c, INK);
    circle(c, x + s * 0.11, y - s * 0.03, s * 0.08);
    fillStroke(c, INK);
  },
  steak: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.35, y);
    c.bezierCurveTo(x - s * 0.35, y - s * 0.35, x + s * 0.3, y - s * 0.3, x + s * 0.36, y);
    c.bezierCurveTo(x + s * 0.4, y + s * 0.3, x - s * 0.1, y + s * 0.34, x - s * 0.35, y);
    fillStroke(c, '#9b2c2c', INK, lw);
    c.strokeStyle = '#3a1a1a';
    c.lineWidth = lw * 0.8;
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.moveTo(x - s * 0.2 + k * s * 0.12, y - s * 0.16);
      c.lineTo(x + s * 0.1 + k * s * 0.12, y + s * 0.16);
      c.stroke();
    }
  },
  tooth: (c, x, y, s) => ICONS.skull(c, x, y, s),
  wave: (c, x, y, s) => {
    c.beginPath();
    c.moveTo(x - s * 0.4, y + s * 0.2);
    c.bezierCurveTo(x - s * 0.3, y - s * 0.4, x + s * 0.3, y - s * 0.3, x + s * 0.1, y + s * 0.05);
    c.bezierCurveTo(x, y - s * 0.1, x - s * 0.1, y + s * 0.05, x, y + s * 0.2);
    c.closePath();
    fillStroke(c, '#1e88e5', INK, lwOf(s));
  },
  bolt: (c, x, y, s) => {
    bolt(c, x - s * 0.22, y - s * 0.42, s * 0.44, s * 0.84);
    fillStroke(c, '#f7d117', INK, lwOf(s));
  },
  car: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.42, y - s * 0.02, s * 0.84, s * 0.2, s * 0.06);
    fillStroke(c, '#c0c6cc', INK, lw);
    fillPoly(c, [x - s * 0.24, y - s * 0.02, x - s * 0.12, y - s * 0.22, x + s * 0.18, y - s * 0.22, x + s * 0.3, y - s * 0.02], '#9ec9e6', INK, lw);
    for (const wx of [-0.24, 0.24]) {
      circle(c, x + wx * s, y + s * 0.18, s * 0.1);
      fillStroke(c, '#111', '#555', lw);
    }
  },
  gun: (c, x, y, s) => {
    const lw = lwOf(s);
    rr(c, x - s * 0.42, y - s * 0.12, s * 0.7, s * 0.1, s * 0.02);
    fillStroke(c, '#3a3a3a', INK, lw);
    fillPoly(c, [x - s * 0.1, y - s * 0.04, x + s * 0.2, y - s * 0.04, x + s * 0.34, y + s * 0.26, x + s * 0.18, y + s * 0.3, x + s * 0.06, y + s * 0.04], '#6d4c41', INK, lw);
  },
  gavel: (c, x, y, s) => ICONS.hammer(c, x, y, s),
  pill: (c, x, y, s) => {
    ICONS.cross(c, x, y, s);
  },
  ghost: (c, x, y, s) => {
    const lw = lwOf(s);
    c.beginPath();
    c.moveTo(x - s * 0.28, y + s * 0.38);
    c.lineTo(x - s * 0.28, y - s * 0.05);
    c.arc(x, y - s * 0.05, s * 0.28, Math.PI, 0);
    c.lineTo(x + s * 0.28, y + s * 0.38);
    for (let k = 0; k < 4; k++) c.lineTo(x + s * 0.28 - (k + 0.5) * s * 0.14, y + s * (k % 2 ? 0.38 : 0.28));
    c.closePath();
    fillStroke(c, '#fff', INK, lw);
    ellipse(c, x - s * 0.1, y - s * 0.06, s * 0.05, s * 0.08);
    fillStroke(c, INK);
    ellipse(c, x + s * 0.1, y - s * 0.06, s * 0.05, s * 0.08);
    fillStroke(c, INK);
  },
  sparkle: (c, x, y, s) => {
    star(c, x, y, s * 0.4, s * 0.08, 4);
    fillStroke(c, '#c6f432', INK, lwOf(s) * 0.6);
  },
  sun: (c, x, y, s) => {
    c.strokeStyle = '#ffb300';
    c.lineWidth = lwOf(s);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * s * 0.26, y + Math.sin(a) * s * 0.26);
      c.lineTo(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4);
      c.stroke();
    }
    circle(c, x, y, s * 0.22);
    fillStroke(c, '#ffd54f', INK, lwOf(s));
  },
  tent: (c, x, y, s) => ICONS.house(c, x, y, s),
};

export type IconId = keyof typeof ICONS;

export function icon(c: Ctx, id: string | undefined, cx: number, cy: number, s: number) {
  const f = id ? ICONS[id] : undefined;
  if (!f) return;
  c.save();
  f(c, cx, cy, s);
  c.restore();
}
