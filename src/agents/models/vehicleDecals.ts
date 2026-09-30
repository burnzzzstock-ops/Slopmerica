// The vehicle decal atlas: plates, grilles, liveries and bumper jokes on one generated 1024x1024 sheet (moved out of
// vehicleModels.ts unchanged; the text on it is the owner's and is not touched by the look pass).
import * as THREE from 'three';

const TILE_COLS = 4, TILE_ROWS = 4;
export const DECAL_TILE: Record<string, number> = {
  sheriff: 0, ambulance: 1, slop: 2, peace: 3,
  plate: 4, grille: 5, stroad: 6, propane: 7,
  fire: 8, tow: 9, bus: 10, stripe: 11,
  transit: 12, trash: 13,
};

let atlas: THREE.Texture | undefined;

/** One generated atlas for seams, grilles, plates, liveries, and bumper jokes. */
export function vehicleDecalAtlas(): THREE.Texture {
  if (atlas) return atlas;
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    atlas = new THREE.DataTexture(data, 1, 1);
    atlas.needsUpdate = true;
    return atlas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const labels = [
    ['SHERIFF', '#ddd7c9', '#17191b'], ['AMBULANCE', '#f4f1e8', '#b21f2d'], ['SLOP', '#111315', '#c6f432'], ['☮', '#e9dfbd', '#e16b5a'],
    ['69-SLOP', '#f1eee2', '#17202a'], ['▦▦▦▦', '#17191b', '#aeb4b8'], ['MY OTHER CAR IS A STROAD', '#eee9dd', '#17191b'], ['I ♥ PROPANE', '#eee9dd', '#b22d26'],
    ['ENGINE 69', '#b31e27', '#f1c95d'], ['SLOP TOW', '#efbd35', '#17191b'], ['FREE LOVE / $8 GAS', '#36a99b', '#f6e9c6'], ['///', '#f3efe7', '#bd2530'],
    ['SLOP TRANSIT', '#c6f432', '#111315'], ['WE TAKE IT ALL', '#2f6b3a', '#f2eee2'],
  ];
  labels.forEach(([text, bg, fg], i) => {
    const x = (i % TILE_COLS) * 256, y = Math.floor(i / TILE_COLS) * 256;
    ctx.fillStyle = bg; ctx.fillRect(x + 8, y + 42, 240, 172);
    ctx.strokeStyle = fg; ctx.lineWidth = 8; ctx.strokeRect(x + 12, y + 46, 232, 164);
    ctx.fillStyle = fg;
    ctx.font = `${text.length > 16 ? 25 : text.length > 9 ? 36 : 62}px Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = text.split(' ');
    if (text.length > 16) {
      const split = Math.ceil(words.length / 2);
      ctx.fillText(words.slice(0, split).join(' '), x + 128, y + 105, 218);
      ctx.fillText(words.slice(split).join(' '), x + 128, y + 158, 218);
    } else ctx.fillText(text, x + 128, y + 130, 218); // squeezed to fit the label: AMBULANCE and SHERIFF were cut off at the box edge
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;
  return atlas;
}

/** uv corners (bottom-left, bottom-right, top-right, top-left) of a decal's label box on the atlas. */
export function tileUv(name: keyof typeof DECAL_TILE): number[] {
  const tile = DECAL_TILE[name];
  const col = tile % TILE_COLS, row = Math.floor(tile / TILE_COLS);
  const u0 = (col + 0.04) / TILE_COLS, u1 = (col + 0.96) / TILE_COLS;
  const v0 = 1 - (row + 0.84) / TILE_ROWS, v1 = 1 - (row + 0.16) / TILE_ROWS;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

import { quadG } from './vehicleKit';

/** A decal panel on a vehicle's side (x > 0 is the car's left), facing outward so the text reads front to back from outside. */
export function sideDecalG(x: number, y0: number, y1: number, z0: number, z1: number, name: keyof typeof DECAL_TILE): THREE.BufferGeometry {
  const uv = tileUv(name);
  return x < 0
    ? quadG([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], uv)
    : quadG([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], uv);
}

/** A decal on the front (z > 0) or rear face, facing outward. */
export function endDecalG(z: number, y0: number, y1: number, x0: number, x1: number, name: keyof typeof DECAL_TILE): THREE.BufferGeometry {
  const uv = tileUv(name);
  return z > 0
    ? quadG([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], uv)
    : quadG([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], uv);
}
