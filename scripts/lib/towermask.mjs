// Shared by scripts/towers.mjs and scripts/towerlab.mjs: a class mask for tower facades and the luma statistics per class.
// Walls of anything taller than TALL metres above its own pad are red ("tower facade"), every other building surface blue,
// road surfaces green, everything else black. A building is anything drawn with the shared building material (the batched
// town and the meshes the showcase / lab add), so a lineup counts too. Read back top-down like nighttest.mjs.

/** Draw the class mask and keep it in window.__cls; then render three normal frames so the next screenshot is the plain picture. */
export const maskPass = (page, TALL) => page.evaluate((TALL) => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera, MBM = g.tools.grade.mesh.material.constructor;
  const bm = new MBM({ color: 0xffffff, toneMapped: false, fog: false });
  bm.onBeforeCompile = (sh) => {
    sh.uniforms.uTall = { value: TALL };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH; varying float vWall;').replace('#include <project_vertex>', '#include <project_vertex>\nvH = transformed.y; vWall = 1.0 - step(0.5, abs(normal.y));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; varying float vWall; uniform float uTall;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor = (vWall > 0.5 && vH > uTall) ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 1.0);');
  };
  bm.customProgramCacheKey = () => 'towers-mask';
  const rm = new MBM({ color: 0x00ff00, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const bmat = g.buildings.mesh.material;
  const rset = new Set([...g.roads.typeMeshes.values(), g.roads.junctionMesh]);
  // (materials are shared by many meshes: remember each one's setting once)
  const saved = [], cw = new Map();
  sc.traverse((o) => {
    if (!o.material) return;
    if (o.material === bmat || o === g.buildings.kitMesh) { saved.push([o, o.material]); o.material = bm; return; }
    if (rset.has(o)) { saved.push([o, o.material]); o.material = rm; return; }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!cw.has(m)) cw.set(m, m.colorWrite); m.colorWrite = false; }
  });
  const bg = sc.background; sc.background = null;
  const cc = R.getClearColor(new bm.color.constructor()), ca = R.getClearAlpha();
  R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear();
  R.render(sc, cam);
  const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (const [o, m] of saved) o.material = m;
  for (const [m, v] of cw) m.colorWrite = v;
  sc.background = bg;
  R.setClearColor(cc, ca);
  bm.dispose(); rm.dispose();
  // 0 other, 1 tower facade, 2 road, 3 other building
  const cls = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; cls[y * w + x] = px[i] > 128 ? 1 : px[i + 1] > 128 ? 2 : px[i + 2] > 128 ? 3 : 0; }
  window.__cls = { cls, w, h };
  for (let i = 0; i < 3; i++) g.frame(0.016);
}, TALL);

/** Luma (0..255) per class of a screenshot (base64 PNG) against the last mask: tower / otherBldg / road / rest. */
export const classStats = (page, b64) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height).data;
  const { cls, w, h } = window.__cls;
  const L = [[], [], [], []];
  const step = Math.max(1, Math.round(img.width / 700));
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const i = (y * img.width + x) * 4;
    L[cls[Math.floor((y * h) / img.height) * w + Math.floor((x * w) / img.width)]].push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  }
  const q = (a, p) => a.length ? Math.round(a[Math.floor(p * (a.length - 1))] * 10) / 10 : 0;
  const sum = (a) => { a.sort((x, y) => x - y); const n = a.length; if (!n) return { n: 0 }; const m = a.reduce((s, v) => s + v, 0) / n; const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / n); return { n, mean: Math.round(m * 10) / 10, sd: Math.round(sd * 10) / 10, dark20: Math.round((a.filter((v) => v < 20).length / n) * 1000) / 10, dark40: Math.round((a.filter((v) => v < 40).length / n) * 1000) / 10, p10: q(a, 0.1), p50: q(a, 0.5), p90: q(a, 0.9) }; };
  return { tower: sum(L[1]), otherBldg: sum(L[3]), road: sum(L[2]), rest: sum(L[0]) };
}, b64);
