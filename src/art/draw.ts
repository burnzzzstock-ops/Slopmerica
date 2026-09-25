// Canvas 2D drawing helpers shared by every painter in the atlas: fonts, fitted
// text, shapes, grime/distress textures, and the Slop brand marks.
import { Rng } from '../core/rng';

export type Ctx = CanvasRenderingContext2D;

// Fonts loaded by index.html (and dev pages). Fallbacks keep signs legible if
// the web fonts haven't arrived.
export const F = {
  script: 'Yellowtail',
  block: 'Anton',
  sign: 'Bungee',
  round: 'Titan One',
  marker: 'Permanent Marker',
  sans: 'Overpass',
  serif: 'Georgia',
} as const;
export type FontFamily = (typeof F)[keyof typeof F];

const FALLBACK: Record<string, string> = {
  Yellowtail: '"Brush Script MT", cursive',
  Anton: 'Impact, "Arial Narrow Bold", sans-serif',
  Bungee: 'Impact, "Arial Black", sans-serif',
  'Titan One': '"Arial Rounded MT Bold", "Arial Black", sans-serif',
  'Permanent Marker': '"Comic Sans MS", cursive',
  Overpass: 'Arial, Helvetica, sans-serif',
  Georgia: '"Times New Roman", serif',
};

export function font(px: number, family: string = F.sans, weight: number | string = 400, italic = false) {
  const q = family.includes(' ') ? `"${family}"` : family;
  return `${italic ? 'italic ' : ''}${weight} ${Math.max(1, Math.round(px))}px ${q}, ${FALLBACK[family] ?? 'sans-serif'}`;
}

export function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rngFor(s: string) {
  return new Rng(strSeed(s));
}

// ------------------------------------------------------------------ color
export function hex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function css(r: number, g: number, b: number, a = 1) {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}
export function mix(a: string, b: string, t: number) {
  const A = hex(a), B = hex(b);
  return css(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function shade(c: string, k: number) {
  return k < 0 ? mix(c, '#000000', -k) : mix(c, '#ffffff', k);
}
export function alpha(c: string, a: number) {
  const A = hex(c);
  return css(A[0], A[1], A[2], a);
}

// ------------------------------------------------------------------ text
export interface TextOpts {
  family?: string;
  weight?: number | string;
  italic?: boolean;
  color?: string;
  stroke?: string;
  strokeW?: number; // as a fraction of font size
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  shadow?: string;
  shadowBlur?: number;
  spacing?: number; // letter spacing, fraction of font size
  maxPx?: number;
  skew?: number;
}

function setLetterSpacing(c: Ctx, px: number) {
  const cc = c as Ctx & { letterSpacing?: string };
  if ('letterSpacing' in cc) cc.letterSpacing = `${px}px`;
}

/** Largest font size (<= maxH) at which `text` fits `maxW`. */
export function fitPx(c: Ctx, text: string, family: string, maxW: number, maxH: number, weight: number | string = 400, spacing = 0) {
  c.font = font(100, family, weight);
  setLetterSpacing(c, spacing * 100);
  const w = c.measureText(text).width;
  setLetterSpacing(c, 0);
  const px = w > 0 ? (maxW / w) * 100 : maxH;
  return Math.max(4, Math.min(maxH, px));
}

/** Draw a line of text sized to fit inside the box (x, y, w, h), centered unless aligned. */
export function textFit(c: Ctx, text: string, x: number, y: number, w: number, h: number, o: TextOpts = {}) {
  const fam = o.family ?? F.sans;
  const wt = o.weight ?? 400;
  let px = fitPx(c, text, fam, w, h, wt, o.spacing ?? 0);
  if (o.maxPx) px = Math.min(px, o.maxPx);
  const align = o.align ?? 'center';
  const tx = align === 'center' ? x + w / 2 : align === 'right' || align === 'end' ? x + w : x;
  // Fonts' cap heights differ; nudge to visually center caps.
  const capK = fam === F.block ? 0.39 : fam === F.script ? 0.28 : fam === F.marker ? 0.36 : 0.36;
  drawText(c, text, tx, y + h / 2 + px * capK, px, { ...o, align, baseline: 'alphabetic' });
  return px;
}

export function drawText(c: Ctx, text: string, x: number, y: number, px: number, o: TextOpts = {}) {
  c.save();
  c.font = font(px, o.family ?? F.sans, o.weight ?? 400, o.italic);
  c.textAlign = o.align ?? 'left';
  c.textBaseline = o.baseline ?? 'alphabetic';
  if (o.spacing) setLetterSpacing(c, o.spacing * px);
  if (o.skew) {
    c.translate(x, y);
    c.transform(1, 0, o.skew, 1, 0, 0);
    x = 0;
    y = 0;
  }
  if (o.shadow) {
    c.shadowColor = o.shadow;
    c.shadowBlur = o.shadowBlur ?? px * 0.15;
    c.shadowOffsetX = o.shadowBlur ? 0 : px * 0.05;
    c.shadowOffsetY = o.shadowBlur ? 0 : px * 0.06;
  }
  if (o.stroke) {
    c.lineJoin = 'round';
    c.strokeStyle = o.stroke;
    c.lineWidth = px * (o.strokeW ?? 0.12);
    c.strokeText(text, x, y);
    c.shadowColor = 'transparent';
  }
  c.fillStyle = o.color ?? '#111';
  c.fillText(text, x, y);
  c.restore();
}

/** Multi-line centered text block fitted into a box. */
export function linesFit(c: Ctx, lines: string[], x: number, y: number, w: number, h: number, o: TextOpts & { gap?: number } = {}) {
  const gap = o.gap ?? 0.12;
  const lh = h / (lines.length + gap * (lines.length - 1));
  let yy = y;
  for (const ln of lines) {
    textFit(c, ln, x, yy, w, lh, o);
    yy += lh * (1 + gap);
  }
}

// ------------------------------------------------------------------ shapes
export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function star(c: Ctx, cx: number, cy: number, ro: number, ri = ro * 0.45, n = 5, rot = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / n;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
}

export function ellipse(c: Ctx, cx: number, cy: number, rx: number, ry: number, rot = 0) {
  c.beginPath();
  c.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2);
}

export function circle(c: Ctx, cx: number, cy: number, r: number) {
  c.beginPath();
  c.arc(cx, cy, Math.abs(r), 0, Math.PI * 2);
}

export function fillPoly(c: Ctx, pts: number[], color: string, stroke?: string, lw = 2) {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) i ? c.lineTo(pts[i], pts[i + 1]) : c.moveTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = color;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.lineJoin = 'round';
    c.stroke();
  }
}

export function fillStroke(c: Ctx, fill: string | CanvasGradient | null, stroke?: string | null, lw = 2) {
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = lw;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
  }
}

/** Lightning bolt path in a w x h box. */
export function bolt(c: Ctx, x: number, y: number, w: number, h: number) {
  const P = [0.62, 0, 0.12, 0.56, 0.46, 0.56, 0.3, 1, 0.9, 0.38, 0.54, 0.38, 0.8, 0];
  c.beginPath();
  for (let i = 0; i < P.length; i += 2) {
    const px = x + P[i] * w, py = y + P[i + 1] * h;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
}

export function stripes(c: Ctx, x: number, y: number, w: number, h: number, colors: string[], n: number, vertical = false) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[i % colors.length];
    if (vertical) c.fillRect(x + (i * w) / n, y, w / n + 0.5, h);
    else c.fillRect(x, y + (i * h) / n, w, h / n + 0.5);
  }
}

export function gradV(c: Ctx, x: number, y: number, w: number, h: number, top: string, bot: string) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
}

// ------------------------------------------------------------------ textures
/** Random speckle: +/- brightness dots. */
export function speckle(c: Ctx, w: number, h: number, rng: Rng, n: number, dark = 0.12, light = 0.08, size = 2) {
  for (let i = 0; i < n; i++) {
    const d = rng.float() < 0.5;
    c.fillStyle = d ? `rgba(0,0,0,${rng.float() * dark})` : `rgba(255,255,255,${rng.float() * light})`;
    const s = size * (0.5 + rng.float());
    c.fillRect(rng.float() * w, rng.float() * h, s, s);
  }
}

/** Water/rust streaks running down from the top plus soft blotches. */
export function grime(c: Ctx, w: number, h: number, rng: Rng, strength = 0.18, color = '30,24,18') {
  for (let i = 0; i < 18; i++) {
    const x = rng.float() * w;
    const len = h * (0.2 + rng.float() * 0.8);
    const g = c.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${color},${strength * rng.float()})`);
    g.addColorStop(1, `rgba(${color},0)`);
    c.fillStyle = g;
    c.fillRect(x, 0, 1 + rng.float() * w * 0.03, len);
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.float() * w, y = rng.float() * h, r = (0.1 + rng.float() * 0.25) * Math.min(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${strength * 0.5 * rng.float()})`);
    g.addColorStop(1, `rgba(${color},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Distressed print: knock out specks and scratches in the background color. */
export function distress(c: Ctx, x: number, y: number, w: number, h: number, bg: string, rng: Rng, density = 1) {
  c.save();
  c.fillStyle = bg;
  c.strokeStyle = bg;
  const n = Math.floor(w * h * 0.004 * density);
  for (let i = 0; i < n; i++) {
    const r = rng.float() ** 2.5 * Math.min(w, h) * 0.02 + 0.4;
    circle(c, x + rng.float() * w, y + rng.float() * h, r);
    c.fill();
  }
  for (let i = 0; i < 14 * density; i++) {
    c.lineWidth = 0.5 + rng.float() * 1.5;
    const sx = x + rng.float() * w, sy = y + rng.float() * h, a = rng.float() * Math.PI;
    const l = (0.05 + rng.float() * 0.2) * w;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l * 0.3);
    c.stroke();
  }
  c.restore();
}

// ------------------------------------------------------------------ SLOP marks
/**
 * "Slop" baseball script with the swoosh tail. (cx, cy) is the visual center,
 * w the total width. Returns the font size used.
 */
export function slopScript(c: Ctx, cx: number, cy: number, w: number, color: string, o: { outline?: string; shadow?: string; tail?: boolean; h?: number } = {}) {
  const px = fitPx(c, 'Slop', F.script, w * 0.86, Math.min(w * 0.62, (o.h ?? Infinity) * 0.82));
  c.save();
  c.font = font(px, F.script);
  const tw = c.measureText('Slop').width;
  const x0 = cx - tw / 2 - w * 0.02;
  const yb = cy + px * 0.22;
  if (o.shadow) {
    c.shadowColor = o.shadow;
    c.shadowOffsetX = px * 0.04;
    c.shadowOffsetY = px * 0.05;
  }
  // tail: thick-in-the-middle swoosh sweeping back under the word
  if (o.tail !== false) {
    const S = px;
    c.beginPath();
    c.moveTo(x0 + tw * 1.02, yb + S * 0.02);
    c.bezierCurveTo(x0 + tw * 0.8, yb + S * 0.17, x0 + tw * 0.35, yb + S * 0.14, x0 + tw * 0.02, yb + S * 0.13);
    c.quadraticCurveTo(x0 - tw * 0.08, yb + S * 0.13, x0 - tw * 0.1, yb + S * 0.08);
    c.quadraticCurveTo(x0 - tw * 0.06, yb + S * 0.21, x0 + tw * 0.1, yb + S * 0.24);
    c.bezierCurveTo(x0 + tw * 0.4, yb + S * 0.3, x0 + tw * 0.85, yb + S * 0.24, x0 + tw * 1.02, yb + S * 0.02);
    c.closePath();
    if (o.outline) {
      c.lineWidth = px * 0.09;
      c.strokeStyle = o.outline;
      c.lineJoin = 'round';
      c.stroke();
    }
    c.fillStyle = color;
    c.fill();
  }
  if (o.outline) {
    c.lineWidth = px * 0.09;
    c.strokeStyle = o.outline;
    c.lineJoin = 'round';
    c.strokeText('Slop', x0, yb);
  }
  c.fillStyle = color;
  c.fillText('Slop', x0, yb);
  c.restore();
  return px;
}

/** SL⚡OP lightning wordmark: thin geometric caps with a bolt between SL and OP. */
export function slopLightning(c: Ctx, x: number, y: number, w: number, h: number, color = '#f7d117', boltColor = color) {
  const px = Math.min(h * 0.9, w / 3.3);
  c.save();
  c.font = font(px, F.sans, 400);
  setLetterSpacing(c, px * 0.12);
  const wSL = c.measureText('SL').width;
  const wOP = c.measureText('OP').width;
  const bw = px * 0.5;
  const total = wSL + bw + wOP + px * 0.1;
  let xx = x + (w - total) / 2;
  const yb = y + h / 2 + px * 0.36;
  c.fillStyle = color;
  c.textBaseline = 'alphabetic';
  c.fillText('SL', xx, yb);
  xx += wSL;
  bolt(c, xx, yb - px * 0.92, bw, px * 1.05);
  c.fillStyle = boltColor;
  c.fill();
  xx += bw + px * 0.1;
  c.fillStyle = color;
  c.fillText('OP', xx, yb);
  c.restore();
}

/** Heavy condensed block slogan (GET IN THE F*CKING CANNON). */
export function blockSlogan(c: Ctx, lines: string[], x: number, y: number, w: number, h: number, color: string, o: { stroke?: string; gap?: number } = {}) {
  linesFit(c, lines, x, y, w, h, { family: F.block, color, stroke: o.stroke, strokeW: 0.1, gap: o.gap ?? 0.04 });
}
