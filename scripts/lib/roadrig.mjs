// A road renderer without a browser: the code under test loaded through Vite's SSR loader, a canvas that draws nothing (the renderer
// paints its textures into canvases; only their existence matters here), a flat stub terrain, and the reference block's roads
// (shots/lookbook/town.json) restored into a network. Used by scripts/junctionmesh.mjs and scripts/junctionplan.mjs.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

export async function makeRig({ roads } = {}) {
  const noop = () => undefined;
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4), width: w, height: h });
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (k === 'measureText') return () => ({ width: 10 });
      return t[k] ?? noop;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
  const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
  const THREE = await server.ssrLoadModule('three');
  const NET = await server.ssrLoadModule('/src/roads/network.ts');
  const MESH = await server.ssrLoadModule('/src/roads/roadMesh.ts');
  const RT = await server.ssrLoadModule('/src/roads/roadTypes.ts');
  const RJ = await server.ssrLoadModule('/src/roads/roadJunction.ts');
  const MATH = await server.ssrLoadModule('/src/core/math.ts');
  const terrain = { h: () => 10, coverAt: () => 0, inBounds: () => true, gradeRoad() {}, forgetRoad() {}, raycast: () => null };
  const net = new NET.RoadNetwork(terrain, { cut() {} });
  net.map = { id: 'flat' };
  net.restore(roads ?? JSON.parse(readFileSync('shots/lookbook/town.json', 'utf8')).roads);
  const rr = new MESH.RoadRenderer(net, { capabilities: { getMaxAnisotropy: () => 4 } });
  const t0 = performance.now();
  rr.update();
  return { server, THREE, NET, MESH, RT, RJ, MATH, net, rr, ROAD_TYPES: RT.ROAD_TYPES, buildMs: performance.now() - t0 };
}
