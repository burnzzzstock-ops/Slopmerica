// Procedural, tileable ground detail textures (grass, dirt, rock, sand) packed
// into one DataArrayTexture. RGB is a brightness/hue modulation around mid-gray
// (the terrain's vertex color supplies the real hue); A is a height for bumps.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const S = 512;

function periodicNoise(size: number, period: number, seed: number) {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  const cell = size / period;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = lat[(y0 % period) * period + (x0 % period)];
      const b = lat[(y0 % period) * period + ((x0 + 1) % period)];
      const c = lat[((y0 + 1) % period) * period + (x0 % period)];
      const d = lat[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  return out;
}

function fbm(size: number, seed: number, periods: number[], weights: number[]) {
  const acc = new Float32Array(size * size);
  let wsum = 0;
  periods.forEach((p, k) => {
    const n = periodicNoise(size, p, seed + k * 101);
    for (let i = 0; i < acc.length; i++) acc[i] += n[i] * weights[k];
    wsum += weights[k];
  });
  for (let i = 0; i < acc.length; i++) acc[i] /= wsum;
  return acc;
}

/** Draw with wrap-around so strokes crossing the edge tile seamlessly. */
function wrapDraw(ctx: CanvasRenderingContext2D, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    const px = x + dx, py = y + dy;
    if (px > -40 && px < S + 40 && py > -40 && py < S + 40) draw(px, py);
  }
}

function layer(seed: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, base: Float32Array, baseAmp: number, tint: [number, number, number]) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 128 + (base[i] - 0.5) * baseAmp;
    img.data[i * 4] = v * tint[0];
    img.data[i * 4 + 1] = v * tint[1];
    img.data[i * 4 + 2] = v * tint[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  paint(ctx, mulberry32(seed));
  const out = ctx.getImageData(0, 0, S, S).data;
  // height from luminance, then normalize the mean brightness to ~128
  let sum = 0;
  for (let i = 0; i < S * S; i++) sum += (out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2]) / 3;
  const k = 128 / (sum / (S * S));
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const r = Math.min(255, out[i * 4] * k), g = Math.min(255, out[i * 4 + 1] * k), b = Math.min(255, out[i * 4 + 2] * k);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = Math.min(255, (r + g + b) / 3);
  }
  return data;
}

export function createGroundTextures(renderer: THREE.WebGLRenderer): THREE.DataArrayTexture {
  const grass = layer(11, (ctx, rnd) => {
    for (let k = 0; k < 14000; k++) {
      const x = rnd() * S, y = rnd() * S;
      const L = 3 + rnd() * 7;
      const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
      const v = 70 + rnd() * 150;
      ctx.strokeStyle = `rgba(${v * 0.92},${v},${v * 0.8},${0.35 + rnd() * 0.4})`;
      ctx.lineWidth = 0.8 + rnd() * 0.8;
      wrapDraw(ctx, x, y, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
        ctx.stroke();
      });
    }
    for (let k = 0; k < 90; k++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18;
      ctx.fillStyle = `rgba(40,50,30,${0.08 + rnd() * 0.1})`;
      wrapDraw(ctx, x, y, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.7, rnd() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
  }, fbm(S, 5, [8, 16, 32], [0.5, 0.3, 0.2]), 90, [0.95, 1.05, 0.88]);

  const dirt = layer(21, (ctx, rnd) => {
    for (let k = 0; k < 2600; k++) {
      const x = rnd() * S, y = rnd() * S, r = 0.8 + rnd() * 3.2;
      const v = 60 + rnd() * 170;
      wrapDraw(ctx, x, y, (px, py) => {
        ctx.fillStyle = `rgba(20,15,10,0.35)`;
        ctx.beginPath();
        ctx.ellipse(px + 0.8, py + 0.8, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${v},${v * 0.92},${v * 0.8})`;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, fbm(S, 9, [4, 8, 16, 64], [0.35, 0.3, 0.2, 0.15]), 150, [1.05, 0.98, 0.88]);

  const rock = layer(31, (ctx, rnd) => {
    for (let k = 0; k < 160; k++) {
      let x = rnd() * S, y = rnd() * S;
      ctx.strokeStyle = `rgba(25,22,20,${0.3 + rnd() * 0.4})`;
      ctx.lineWidth = 0.6 + rnd() * 1.6;
      const segs = 4 + Math.floor(rnd() * 8);
      let a = rnd() * Math.PI * 2;
      for (let s = 0; s < segs; s++) {
        const nx = x + Math.cos(a) * (6 + rnd() * 14), ny = y + Math.sin(a) * (6 + rnd() * 14);
        wrapDraw(ctx, x, y, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx - x, py + ny - y); ctx.stroke(); });
        x = nx; y = ny;
        a += (rnd() - 0.5) * 1.1;
      }
    }
    for (let y = 0; y < S; y += 9 + Math.floor(rnd() * 10)) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`;
      ctx.fillRect(0, y, S, 2);
    }
  }, fbm(S, 13, [4, 8, 32, 64], [0.4, 0.3, 0.2, 0.1]), 170, [1, 0.98, 0.95]);

  const sand = layer(41, (ctx, rnd) => {
    for (let y = 0; y < S; y++) {
      const v = Math.sin((y / S) * Math.PI * 2 * 24 + Math.sin((y / S) * Math.PI * 2 * 3) * 2);
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) * 0.05})`;
      ctx.fillRect(0, y, S, 1);
    }
    for (let k = 0; k < 20000; k++) {
      const v = 90 + rnd() * 160;
      ctx.fillStyle = `rgb(${v},${v * 0.97},${v * 0.9})`;
      ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
    }
  }, fbm(S, 17, [8, 32, 128], [0.4, 0.4, 0.2]), 60, [1.03, 1, 0.94]);

  const data = new Uint8Array(S * S * 4 * 4);
  [grass, dirt, rock, sand].forEach((l, k) => data.set(l, k * S * S * 4));
  const tex = new THREE.DataArrayTexture(data, S, S, 4);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
