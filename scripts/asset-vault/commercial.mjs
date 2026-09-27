import { Model, THREE, variation } from './kit.mjs';

const R = (x = 0, y = 0, z = 0) => [x, y, z];
const mats = {
  wall: 'stucco-ivory', pale: 'brick-cream', red: 'brick-red', slab: 'concrete',
  dark: 'metal-dark', steel: 'metal-galvanized', roof: 'roof-metal', shingle: 'roof-shingle',
  glass: 'glass-blue', tire: 'rubber', wood: 'wood-painted', dirt: 'soil', green: 'foliage',
  teal: 'paint-teal', hot: 'paint-red', yellow: 'paint-yellow', blue: 'paint-blue',
  white: 'paint-white', orange: 'paint-orange', stone: 'limestone', copper: 'metal-copper',
};

function box(m, name, size, pos, mat = mats.wall, rotation = R()) {
  return m.box(name, size, pos, mat, { bevel: 0.035, rotation });
}
function cyl(m, name, rt, rb, h, pos, mat = mats.steel, rotation = R(), segments = 12) {
  return m.cylinder(name, rt, rb, h, pos, mat, { segments, rotation });
}
function sphere(m, name, radii, pos, mat = mats.wall) {
  return m.sphere(name, radii, pos, mat);
}
function torus(m, name, radius, tube, pos, mat = mats.hot, rotation = R(), arc = Math.PI * 2) {
  return m.torus(name, radius, tube, pos, mat, { rotation, arc });
}
function pipe(m, name, points, radius, mat = mats.dark) {
  return m.pipe(name, points, radius, mat);
}
function sign(m, name, size, pos, rotation = R()) {
  return m.sign(name, size, pos, { rotation });
}

function storefront(m, w, h, d, v, accent, opts = {}) {
  const side = v.side;
  box(m, 'store-shell', [w, h, d], [0, h / 2, 0], opts.wall || mats.wall);
  box(m, 'roof-cap', [w + 0.25, 0.22, d + 0.25], [0, h + 0.11, 0], opts.roof || mats.dark);
  const winCount = m.lod === 0 ? Math.min(6, v.bays + 1) : m.lod === 1 ? 3 : 1;
  const glassY = Math.min(1.65, h * 0.44);
  for (let i = 0; i < winCount; i++) {
    const x = winCount === 1 ? 0 : -w * 0.37 + i * (w * 0.74 / (winCount - 1));
    box(m, `window-${i}`, [Math.max(0.55, w / (winCount * 1.55)), 1.45, 0.09], [x, glassY, d / 2 + 0.055], mats.glass);
  }
  box(m, 'door', [0.92, 2.05, 0.12], [side * w * 0.35, 1.025, d / 2 + 0.07], mats.dark);
  if (m.lod < 2) {
    box(m, 'awning', [w * 0.82, 0.18, 1.05], [0, h * 0.66, d / 2 + 0.48], accent, R(-0.08, 0, 0));
    for (let i = 0; i < Math.min(4, v.bays); i++) {
      const x = -w * 0.32 + i * (w * 0.64 / Math.max(1, Math.min(4, v.bays) - 1));
      box(m, `mullion-${i}`, [0.08, 1.55, 0.12], [x, glassY, d / 2 + 0.12], accent);
    }
  }
  sign(m, 'primary-sign', [Math.min(w * 0.62, 7.5), 1.15], [0, h * 0.79, d / 2 + 0.16]);
}

function posts(m, prefix, xs, y, z, height, mat = mats.steel) {
  for (let i = 0; i < xs.length; i++) cyl(m, `${prefix}-${i}`, 0.1, 0.1, height, [xs[i], y + height / 2, z], mat, R(), 8);
}
function canopy(m, w, d, y, z, accent, columns = 4) {
  box(m, 'canopy', [w, 0.35, d], [0, y, z], accent);
  const xs = columns === 2 ? [-w * 0.4, w * 0.4] : [-w * 0.42, -w * 0.14, w * 0.14, w * 0.42];
  posts(m, 'canopy-post', xs, 0, z, y - 0.18, mats.steel);
}
function poleSign(m, v, x, z, height = 7) {
  cyl(m, 'pole-sign-post', 0.16, 0.2, height, [x, height / 2, z], mats.dark, R(), 10);
  sign(m, 'pole-sign', [3.2 + v.size * 0.22, 1.65], [x, height, z]);
}
function annex(m, v, w, d, h, mat = mats.pale) {
  const x = v.side * (w * 0.42 + 1.1 + v.layout * 0.18);
  box(m, 'layout-annex', [2.4 + v.layout * 0.35, h, d * (0.42 + v.layout * 0.04)], [x, h / 2, -d * 0.16], mat);
  return x;
}
function stateMarker(m, v, w, d, accent) {
  if (v.state) {
    box(m, 'busy-state-queue-bar', [w * 0.72, 0.12, 0.12], [0, 0.65, d * 0.63], accent);
    const n = m.lod === 0 ? 5 : m.lod === 1 ? 3 : 1;
    for (let i = 0; i < n; i++) box(m, `queue-car-${i}`, [1.35, 0.65, 0.7], [-w * 0.3 + i * w * 0.15, 0.34, d * (0.7 + 0.08 * (i % 2))], i % 2 ? mats.blue : mats.hot);
  } else {
    box(m, 'open-state-bollard', [0.22, 0.85, 0.22], [v.side * w * 0.43, 0.425, d * 0.56], accent);
  }
}
function wheel(m, name, x, y, z, radius = 0.42) {
  torus(m, name, radius, 0.13, [x, Math.max(y, radius + 0.14), z], mats.tire, R(0, Math.PI / 2, 0));
}
function tinyCar(m, name, x, z, color = mats.hot, heading = 0) {
  box(m, `${name}-body`, [1.65, 0.45, 0.85], [x, 0.53, z], color, R(0, heading, 0));
  box(m, `${name}-cab`, [0.82, 0.4, 0.72], [x, 0.93, z - 0.05], mats.glass, R(0, heading, 0));
  if (m.lod < 2) {
    wheel(m, `${name}-wheel-a`, x - 0.52, 0.4, z + 0.42);
    wheel(m, `${name}-wheel-b`, x + 0.52, 0.4, z + 0.42);
  }
}
function pitchedRoof(m, w, d, y, mat = mats.roof) {
  box(m, 'roof-left', [w * 0.55, 0.22, d + 0.15], [-w * 0.23, y, 0], mat, R(0, 0, 0.38));
  box(m, 'roof-right', [w * 0.55, 0.22, d + 0.15], [w * 0.23, y, 0], mat, R(0, 0, -0.38));
}

function build(spec, variant, lod) {
  const v = variation(variant);
  const m = new Model(lod);
  m.group.name = `${spec.id}-${variant}-lod${lod}`;
  const w = Math.min(26, (spec.w || 11) * v.scale);
  const d = Math.min(24, (spec.d || 8) * (0.92 + v.layout * 0.045));
  const h = (spec.h || 4) * (0.94 + v.size * 0.025);
  const a = spec.accent || mats.hot;
  box(m, 'foundation', [Math.min(30, w + 2.2), 0.16, Math.min(28, d + 2.2)], [0, 0.08, 0], mats.slab);

  switch (spec.kind) {
    case 'drive-loop': {
      storefront(m, w * 0.72, h, d * 0.7, v, a);
      const laneX = v.side * w * 0.5;
      canopy(m, w * 0.44, 2.2, h * 0.72, d * 0.33, a, 2);
      box(m, 'order-menu', [1.15, 1.55, 0.16], [laneX, 1.15, -d * 0.15], mats.dark);
      pipe(m, 'drive-loop-rail', [[laneX, 0.35, -d * 0.42], [laneX + v.side * 1.6, 0.35, 0], [laneX, 0.35, d * 0.48]], 0.08, mats.yellow);
      break;
    }
    case 'burger-tower': {
      storefront(m, w * 0.82, h, d, v, a);
      cyl(m, 'baron-tower', 1.15, 1.45, h * 1.35, [v.side * w * 0.34, h * 0.68, -d * 0.12], mats.red, R(), 10);
      for (let i = 0; i < (m.lod < 2 ? 5 : 3); i++) box(m, `crown-${i}`, [0.35, 0.8 + (i % 2) * 0.35, 0.35], [v.side * w * 0.34 + (i - 2) * 0.38, h * 1.5, -d * 0.12], mats.yellow, R(0, 0, (i - 2) * -0.1));
      break;
    }
    case 'waffle-diner': {
      box(m, 'diner-car', [w, h * 0.7, d], [0, h * 0.35, 0], mats.steel);
      box(m, 'glass-band', [w * 0.88, h * 0.28, d + 0.1], [0, h * 0.46, 0], mats.glass);
      box(m, 'diner-roof', [w + 0.7, 0.28, d + 0.7], [0, h * 0.74, 0], a);
      const tiles = m.lod === 0 ? 8 : m.lod === 1 ? 5 : 2;
      for (let i = 0; i < tiles; i++) box(m, `waffle-tile-${i}`, [0.82, 0.82, 0.13], [-tiles * 0.43 + 0.43 + i * 0.86, h * 0.95 + (i % 2) * 0.08, d / 2 + 0.2], i % 2 ? mats.yellow : mats.dark);
      break;
    }
    case 'donut-ring': {
      storefront(m, w * 0.75, h * 0.8, d * 0.82, v, a);
      torus(m, 'giant-donut', 1.6 + v.size * 0.08, 0.52, [v.side * w * 0.29, h + 1.45, d * 0.15], mats.orange, R(0, 0, 0));
      if (m.lod === 0) for (let i = 0; i < 8; i++) box(m, `sprinkle-${i}`, [0.08, 0.32, 0.1], [v.side * w * 0.29 + Math.cos(i) * 1.25, h + 1.45 + Math.sin(i) * 1.25, d * 0.15 + 0.5], i % 2 ? mats.teal : mats.white, R(0, 0, i));
      break;
    }
    case 'coffee-cup': {
      cyl(m, 'cup-shop', w * 0.34, w * 0.27, h, [0, h / 2, 0], mats.pale, R(), m.lod === 2 ? 10 : 18);
      cyl(m, 'coffee-rim', w * 0.36, w * 0.36, 0.3, [0, h, 0], a, R(), 18);
      torus(m, 'cup-handle', h * 0.38, 0.22, [v.side * w * 0.34, h * 0.55, 0], a, R(0, Math.PI / 2, 0), Math.PI * 1.55);
      pipe(m, 'steam', [[-0.5, h + 0.2, 0], [-0.8, h + 1.1, 0], [-0.35, h + 1.8, 0]], 0.09, mats.white);
      sign(m, 'cup-sign', [3.6, 1.05], [0, h * 0.57, w * 0.29]);
      break;
    }
    case 'daiquiri-cup': {
      cyl(m, 'cup-base', w * 0.36, w * 0.29, h * 0.78, [0, h * 0.39, 0], mats.teal, R(), 14);
      cyl(m, 'frozen-top', w * 0.39, w * 0.36, h * 0.25, [0, h * 0.9, 0], mats.orange, R(), 14);
      pipe(m, 'giant-straw', [[v.side * 0.6, h, 0], [v.side * 1.1, h * 1.75, 0]], 0.15, mats.hot);
      box(m, 'drive-window', [2.1, 1.4, 0.12], [0, h * 0.45, d * 0.39], mats.glass);
      sign(m, 'cup-sign', [w * 0.52, 1.1], [0, h * 0.72, d * 0.4]);
      break;
    }
    case 'smokehouse': {
      box(m, 'barn', [w, h, d], [0, h / 2, 0], mats.red);
      pitchedRoof(m, w + 0.4, d + 0.5, h + 0.55, mats.shingle);
      annex(m, v, w, d, h * 0.62, mats.wood);
      const stacks = m.lod === 0 ? 3 : 1;
      for (let i = 0; i < stacks; i++) cyl(m, `smoker-${i}`, 0.32, 0.38, 2.6, [-w * 0.25 + i * 1.2, h + 1.1, -d * 0.22], mats.dark, R(), 10);
      sign(m, 'barn-sign', [w * 0.52, 1.15], [0, h * 0.67, d / 2 + 0.12]);
      break;
    }
    case 'fuel-fort': {
      storefront(m, w * 0.46, h * 0.76, d * 0.52, v, a);
      canopy(m, w * 0.88, d * 0.48, h * 0.85, d * 0.45, a, 4);
      const pumps = m.lod === 0 ? v.bays : m.lod === 1 ? 3 : 1;
      for (let i = 0; i < pumps; i++) box(m, `pump-${i}`, [0.55, 1.25, 0.45], [-w * 0.34 + i * (w * 0.68 / Math.max(1, pumps - 1)), 0.63, d * 0.45], i % 2 ? mats.blue : mats.hot);
      poleSign(m, v, v.side * w * 0.45, -d * 0.42, 6 + v.layout * 0.6);
      break;
    }
    case 'oasis-station': {
      storefront(m, w * 0.55, h * 0.7, d * 0.58, v, a);
      canopy(m, w * 0.72, d * 0.38, h * 0.76, d * 0.42, mats.teal, 4);
      cyl(m, 'palm-trunk', 0.12, 0.24, h * 1.65, [v.side * w * 0.42, h * 0.82 + 0.12, -d * 0.2], mats.wood, R(0, 0, -v.side * 0.11), 9);
      for (let i = 0; i < (m.lod < 2 ? 7 : 4); i++) box(m, `palm-frond-${i}`, [2.4, 0.12, 0.48], [v.side * w * 0.42 + Math.cos(i) * 0.7, h * 1.67, -d * 0.2 + Math.sin(i) * 0.7], mats.green, R(0, i * 0.9, (i % 2 ? 0.12 : -0.12)));
      break;
    }
    case 'wash-tunnel': {
      box(m, 'wash-tunnel', [w, h, d], [0, h / 2, 0], mats.blue);
      const portals = m.lod === 0 ? 4 : m.lod === 1 ? 3 : 1;
      for (let i = 0; i < portals; i++) torus(m, `wash-arch-${i}`, Math.min(w, h) * 0.3, 0.18, [0, h * 0.48, -d * 0.38 + i * d * 0.25], i % 2 ? mats.yellow : a, R(Math.PI / 2, 0, 0), Math.PI);
      box(m, 'tunnel-mouth', [w * 0.58, h * 0.65, 0.15], [0, h * 0.34, d / 2 + 0.09], mats.dark);
      sign(m, 'wash-sign', [w * 0.55, 1.0], [0, h * 0.82, d / 2 + 0.12]);
      break;
    }
    case 'wash-chapel': {
      box(m, 'nave', [w * 0.66, h, d], [0, h / 2, 0], mats.pale);
      pitchedRoof(m, w * 0.7, d + 0.4, h + 0.5, mats.blue);
      cyl(m, 'spire', 0.15, 0.65, h * 1.2, [v.side * w * 0.24, h * 1.2, -d * 0.22], a, R(), 8);
      torus(m, 'halo-brush', 1.2, 0.22, [0, h * 0.46, d / 2 + 0.2], mats.teal);
      box(m, 'wash-door', [w * 0.4, h * 0.56, 0.2], [0, h * 0.3, d / 2 + 0.1], mats.dark);
      break;
    }
    case 'dealership': {
      storefront(m, w, h * 0.78, d * 0.58, v, a, { wall: mats.glass });
      box(m, 'showroom-wing', [w * 0.42, h * 0.58, d * 0.38], [v.side * w * 0.35, h * 0.29, -d * 0.42], mats.white, R(0, v.side * 0.18, 0));
      tinyCar(m, 'display-car', v.side * w * 0.28, d * 0.45, a, v.side * -0.22);
      const flags = m.lod === 0 ? 5 : 2;
      for (let i = 0; i < flags; i++) { const x = -w * 0.42 + i * w * 0.84 / Math.max(1, flags - 1); cyl(m, `flagpole-${i}`, .05, .07, h * 1.3, [x, h * .65, -d * .35], mats.steel, R(), 6); box(m, `flag-${i}`, [.65,.38,.04], [x+.31,h*1.14,-d*.35], i%2?mats.hot:mats.blue); }
      break;
    }
    case 'repo-yard': {
      box(m, 'repo-office', [w * 0.44, h * 0.68, d * 0.45], [-v.side * w * 0.25, h * 0.34, -d * 0.2], mats.steel);
      const fenceN = m.lod === 0 ? 8 : m.lod === 1 ? 4 : 2;
      for (let i = 0; i < fenceN; i++) box(m, `fence-${i}`, [w / fenceN - .08, 1.8, .08], [-w/2+(i+.5)*w/fenceN, .9, d/2], mats.dark);
      cyl(m, 'watch-pole', .22, .3, h * 1.7, [v.side*w*.36,h*.85,-d*.34], mats.dark, R(), 8);
      box(m, 'watch-box', [1.8,1.3,1.5], [v.side*w*.36,h*1.55,-d*.34], mats.glass);
      if (m.lod < 2) for(let i=0;i<3+v.layout;i++) tinyCar(m,`repo-car-${i}`,-w*.23+i*1.9,-d*.05+(i%2)*1.4,i%2?mats.yellow:mats.red);
      break;
    }
    case 'strip': {
      box(m, 'strip-shell', [w, h, d], [0,h/2,0], mats.pale);
      const bays = m.lod === 0 ? v.bays + 1 : m.lod === 1 ? 3 : 2;
      for(let i=0;i<bays;i++) { const x=-w/2+(i+.5)*w/bays; box(m,`tenant-${i}`,[w/bays-.16,h*.48,.12],[x,h*.29,d/2+.08],i%2?mats.glass:mats.dark); box(m,`tenant-awning-${i}`,[w/bays-.1,.14,.82],[x,h*.58,d/2+.34],[mats.hot,mats.yellow,mats.teal,mats.blue][i%4]); }
      box(m,'parapet',[w+.25,.55,d+.18],[0,h+.27,0],mats.wall);
      annex(m,v,w,d,h*.72,mats.red);
      break;
    }
    case 'popup-tent': {
      box(m,'seasonal-floor',[w,.18,d],[0,.09,0],mats.slab);
      const tents=m.lod===0?4+v.layout:m.lod===1?3:1;
      for(let i=0;i<tents;i++){ const x=-w*.38+i*w*.76/Math.max(1,tents-1); cyl(m,`tent-peak-${i}`,1.2,2.0,h*.62,[x,h*.31,0],i%2?a:mats.dark,R(),6); box(m,`tent-door-${i}`,[.7,1.4,.08],[x,.72,d*.31],mats.glass); }
      cyl(m,'inflatable-specter',.28,.75,h*1.45,[v.side*w*.43,h*.73,-d*.32],mats.white,R(),10);
      sphere(m,'specter-head',[.72,.72,.72],[v.side*w*.43,h*1.46,-d*.32],mats.white);
      break;
    }
    case 'monster-box': {
      box(m,'big-box',[w,h,d],[0,h/2,0],mats.wall);
      box(m,'giant-brow',[w*.58,.55,1.15],[0,h*.68,d/2+.46],a,R(-.12,0,0));
      box(m,'mouth-entry',[w*.42,h*.45,.18],[0,h*.24,d/2+.1],mats.glass);
      const teeth=m.lod===0?9:m.lod===1?5:3;
      for(let i=0;i<teeth;i++) cyl(m,`entry-tooth-${i}`,0,.22,.65,[-w*.18+i*w*.36/Math.max(1,teeth-1),h*.47,d/2+.22],mats.white,R(Math.PI,0,0),4);
      annex(m,v,w,d,h*.52,mats.steel);
      break;
    }
    case 'bulk-barrel': {
      box(m,'bulk-base',[w,h*.68,d],[0,h*.34,0],mats.steel);
      cyl(m,'barrel-roof',d*.38,d*.38,w,[0,Math.max(h*.72,d*.38)+.05,0],mats.roof,R(0,0,Math.PI/2),m.lod===2?8:16);
      box(m,'dock-mouth',[w*.18,h*.42,.15],[v.side*w*.33,h*.24,d/2+.1],mats.dark);
      const carts=m.lod===0?6:m.lod===1?3:1;
      for(let i=0;i<carts;i++) box(m,`cart-${i}`,[.9,.55,.55],[-w*.3+i*1.05,.4,d*.63+(i%2)*.7],mats.steel,R(0,.2*i,0));
      sign(m,'bulk-sign',[w*.42,1.3],[0,h*.7,d/2+.16]);
      break;
    }
    case 'tractor-silo': {
      storefront(m,w*.68,h*.7,d*.7,v,a,{wall:mats.red,roof:mats.roof});
      cyl(m,'retail-silo',d*.22,d*.24,h*1.35,[v.side*w*.37,h*.68,-d*.18],mats.steel,R(),m.lod===2?10:16);
      cyl(m,'silo-cap',0,d*.26,d*.38,[v.side*w*.37,h*1.53,-d*.18],mats.roof,R(),12);
      if(m.lod<2){ box(m,'tractor-body',[2.0,.7,1.0],[-v.side*w*.22,.7,d*.6],mats.yellow); wheel(m,'tractor-wheel-big',-v.side*w*.22-v.side*.62,.55,d*.6+.5,.62); wheel(m,'tractor-wheel-small',-v.side*w*.22+v.side*.7,.43,d*.6+.5,.38); }
      break;
    }
    case 'twin-mattress': {
      const gap=.7+v.layout*.22;
      box(m,'store-a',[w*.46,h,d],[ -w*.25-gap/2,h/2,0],mats.white);
      box(m,'store-b',[w*.46,h*(.86+v.layout*.04),d],[w*.25+gap/2,h*(.43+v.layout*.02),0],mats.blue);
      sign(m,'sign-a',[w*.34,1.05],[-w*.25-gap/2,h*.72,d/2+.12]); sign(m,'sign-b',[w*.34,1.05],[w*.25+gap/2,h*.67,d/2+.12]);
      box(m,'giant-mattress',[w*.42,.7,d*.28],[0,h+.45,-d*.12],mats.white,R(.08,v.side*.22,.12));
      stateMarker(m,v,w,d,a);
      break;
    }
    case 'payday-vault': {
      storefront(m,w,h,d,v,a,{wall:mats.green||mats.teal});
      cyl(m,'vault-door',1.55,1.55,.25,[0,h*.42,d/2+.18],mats.steel,R(Math.PI/2,0,0),18);
      torus(m,'apr-ring',2.1,.22,[v.side*w*.3,h*1.12,0],mats.yellow);
      const ticks=m.lod===0?8:4; for(let i=0;i<ticks;i++) box(m,`percent-tick-${i}`,[.18,.65,.18],[v.side*w*.3+Math.cos(i)*1.65,h*1.12+Math.sin(i)*1.65,.12],mats.hot,R(0,0,i*.78));
      break;
    }
    case 'umbrella-office': {
      storefront(m,w*.75,h*.74,d*.72,v,a);
      cyl(m,'umbrella-pole',.12,.12,h*1.55,[0,h*.78,0],mats.dark,R(),8);
      cyl(m,'umbrella-canopy',0,w*.34,h*.34,[0,h*1.44,0],a,R(Math.PI,0,0),m.lod===2?10:18);
      pipe(m,'denial-hook',[[v.side*w*.36,h*.1,d*.45],[v.side*w*.48,h*.8,d*.45],[v.side*w*.35,h*1.05,d*.45]],.12,mats.dark);
      break;
    }
    case 'urgent-cross': {
      storefront(m,w,h,d,v,a,{wall:mats.white});
      box(m,'medical-cross-v',[1.1,3.2,.18],[v.side*w*.28,h*.67,d/2+.13],a);
      box(m,'medical-cross-h',[3.2,1.1,.2],[v.side*w*.28,h*.67,d/2+.14],a);
      canopy(m,w*.36,2.2,h*.78,d*.38,mats.white,2);
      stateMarker(m,v,w,d,a);
      break;
    }
    case 'wallet-er': {
      box(m,'er-block',[w,h,d],[0,h/2,0],mats.white);
      box(m,'emergency-wing',[w*.48,h*.72,d*.52],[v.side*w*.38,h*.36,d*.25],mats.red,R(0,v.side*.12,0));
      cyl(m,'helipad',w*.27,w*.27,.18,[0,h+.18,0],mats.slab,R(),24);
      box(m,'helipad-h1',[w*.16,.04,.5],[0,h+.3,0],mats.white); box(m,'helipad-h2',[.5,.04,w*.16],[0,h+.31,0],mats.white);
      canopy(m,w*.38,d*.25,h*.7,d*.58,mats.red,2);
      sign(m,'er-sign',[w*.42,1.2],[0,h*.72,d/2+.15]);
      break;
    }
    case 'tooth-clinic': {
      storefront(m,w*.72,h*.7,d*.72,v,a,{wall:mats.teal});
      const roots=m.lod===0?4:m.lod===1?3:2;
      sphere(m,'tooth-crown',[2.0,1.55,.65],[v.side*w*.3,h*1.1,0],mats.white);
      for(let i=0;i<roots;i++) cyl(m,`tooth-root-${i}`,.18,.38,1.5,[v.side*w*.3+(i-(roots-1)/2)*.55,h*.25,0],mats.white,R(0,0,(i-(roots-1)/2)*.13),8);
      torus(m,'finance-brace',1.35,.1,[v.side*w*.3,h*1.12,.68],mats.steel);
      break;
    }
    case 'subscription-kiosk': {
      cyl(m,'subscription-hub',w*.25,w*.31,h,[0,h/2,0],mats.dark,R(),m.lod===2?8:16);
      const pods=m.lod===0?6:m.lod===1?4:3;
      for(let i=0;i<pods;i++){ const ang=i*Math.PI*2/pods+v.layout*.17; const x=Math.cos(ang)*w*.34,z=Math.sin(ang)*d*.34; box(m,`recurring-pod-${i}`,[2.0,2.3,1.25],[x,1.15,z],[mats.teal,mats.orange,mats.blue][i%3],R(0,-ang,0)); }
      torus(m,'recurring-arrow',w*.35,.18,[0,h*.74,0],a,R(Math.PI/2,0,0),Math.PI*1.7);
      sign(m,'subscription-sign',[3.8,1.0],[0,h*.55,d*.32]);
      break;
    }
    case 'storage-rows': {
      const rows=m.lod===0?4:m.lod===1?3:2;
      for(let r=0;r<rows;r++){ const z=-d*.38+r*d*.76/Math.max(1,rows-1); box(m,`storage-row-${r}`,[w,h*.55,d/rows*.62],[0,h*.275,z],mats.steel); const doors=m.lod===0?v.bays+2:2; for(let i=0;i<doors;i++) box(m,`door-${r}-${i}`,[w/doors-.18,h*.38,.08],[-w/2+(i+.5)*w/doors,h*.25,z+d/rows*.32],i%2?mats.orange:mats.blue); }
      cyl(m,'storage-beacon',.18,.22,h*1.6,[v.side*w*.45,h*.8,-d*.45],mats.dark,R(),8); sign(m,'storage-sign',[3.3,1.35],[v.side*w*.45,h*1.42,-d*.45]);
      break;
    }
    case 'parcel-depot': {
      box(m,'parcel-shed',[w,h,d],[0,h/2,0],mats.steel);
      const docks=m.lod===0?v.bays+1:m.lod===1?3:1;
      for(let i=0;i<docks;i++) box(m,`dock-${i}`,[w/docks-.25,h*.42,.18],[-w/2+(i+.5)*w/docks,h*.24,d/2+.11],mats.dark);
      box(m,'conveyor',[w*.75,.45,1.0],[0,1.0,d*.68],a,R(0,v.side*.12,0));
      if(m.lod<2) for(let i=0;i<5;i++) box(m,`parcel-${i}`,[.55+i*.05,.4,.45],[-w*.28+i*w*.14,1.43,d*.68],i%2?mats.pale:mats.yellow,R(0,i*.2,0));
      pipe(m,'panic-chute',[[v.side*w*.38,h*.8,-d*.2],[v.side*w*.5,h*.35,d*.2],[v.side*w*.38,.7,d*.62]],.34,mats.orange);
      break;
    }
    case 'locker-hive': {
      box(m,'locker-wall',[w,h*.78,d*.36],[0,h*.39,0],mats.dark);
      const cols=m.lod===0?v.bays+4:m.lod===1?4:2, rows=m.lod===0?3:2;
      for(let y=0;y<rows;y++) for(let i=0;i<cols;i++) box(m,`locker-${y}-${i}`,[w/cols-.1,h*.62/rows-.1,.18],[-w/2+(i+.5)*w/cols,.25+(y+.5)*h*.62/rows,d*.19+.1],[mats.yellow,mats.teal,mats.orange][(i+y)%3]);
      cyl(m,'parcel-eye',.7,.9,.7,[v.side*w*.36,h*1.05,0],a,R(Math.PI/2,0,0),12); sphere(m,'parcel-eye-lens',[.32,.32,.18],[v.side*w*.36,h*1.05,d*.3],mats.glass);
      pitchedRoof(m,w+.35,d*.58,h*.82,mats.roof);
      break;
    }
    case 'ghost-kitchen': {
      const modules=m.lod===0?4+v.layout:m.lod===1?3:2;
      for(let i=0;i<modules;i++){ const x=-w*.38+i*w*.76/Math.max(1,modules-1); box(m,`kitchen-${i}`,[w/modules-.15,h*.62,d],[x,h*.31,0],i%2?mats.steel:mats.white); cyl(m,`exhaust-${i}`,.2,.34,h*.76,[x,h*.96,-d*.18],mats.dark,R(),10); if(m.lod===0) sphere(m,`steam-${i}`,[.32,.22,.32],[x,h*1.37,-d*.18],mats.white); }
      box(m,'pickup-shelf',[w*.72,.35,.72],[0,1.0,d*.58],a);
      sign(m,'ghost-sign',[w*.48,1.0],[0,h*.52,d/2+.14]);
      break;
    }
    case 'dispatch-tower': {
      box(m,'dispatch-base',[w*.58,h*.42,d*.7],[0,h*.21,0],mats.dark);
      cyl(m,'dispatch-tower',1.15,1.65,h*1.55,[0,h*.93,0],mats.blue,R(),12);
      const dishes=m.lod===0?4:m.lod===1?2:1; for(let i=0;i<dishes;i++) torus(m,`signal-${i}`,1+i*.42,.09,[0,h*1.65+i*.18,0],i%2?mats.teal:a,R(Math.PI/2,0,0));
      pipe(m,'antenna',[[0,h*1.45,0],[v.side*.4,h*2.15,0]],.09,mats.steel);
      if(m.lod<2) for(let i=0;i<3;i++) { box(m,`scooter-${i}`,[.9,.35,.32],[-2+i*2,.45,d*.55],i%2?mats.hot:mats.yellow); wheel(m,`scooter-wheel-${i}`,-2+i*2,.3,d*.72,.22); }
      sign(m,'dispatch-sign',[w*.42,1.0],[0,h*.34,d*.36]);
      break;
    }
    case 'return-funnel': {
      storefront(m,w*.62,h*.58,d*.62,v,a,{wall:mats.steel});
      cyl(m,'return-funnel',w*.12,w*.34,h*1.2,[v.side*w*.3,h*.85,-d*.1],mats.orange,R(Math.PI,0,0),14);
      pipe(m,'return-chute',[[v.side*w*.3,h*.32,-d*.1],[0,h*.15,d*.42],[0,.55,d*.68]],.38,mats.dark);
      if(m.lod<2) for(let i=0;i<4;i++) box(m,`returned-box-${i}`,[.7,.5,.6],[-1.5+i, .35+(i%2)*.45,d*.62],i%2?mats.pale:mats.yellow,R(0,i*.22,0));
      sign(m,'return-sign',[w*.4,1.0],[0,h*.44,d*.32]);
      break;
    }
    case 'loyalty-lab': {
      box(m,'lab',[w,h*.68,d],[0,h*.34,0],mats.white);
      const tubes=m.lod===0?5:m.lod===1?3:2;
      for(let i=0;i<tubes;i++){ const x=-w*.34+i*w*.68/Math.max(1,tubes-1); cyl(m,`points-tube-${i}`,.42,.42,h*.9,[x,h*.62,d*.28],[mats.teal,mats.orange,mats.blue][i%3],R(),12); sphere(m,`tube-cap-${i}`,[.44,.25,.44],[x,h*1.08,d*.28],mats.glass); }
      torus(m,'loyalty-orbit',w*.31,.14,[0,h*1.25,0],a,R(Math.PI/2,v.layout*.18,0));
      sign(m,'lab-sign',[w*.46,1.0],[0,h*.48,d/2+.13]);
      break;
    }
    case 'appliance-stack': {
      const levels=m.lod===0?3:m.lod===1?2:1;
      for(let y=0;y<levels;y++) for(let i=0;i<3;i++){ const x=(i-1)*w*.25+v.side*y*.25; box(m,`appliance-${y}-${i}`,[w*.22,h*.72,d*.55],[x,h*.36+y*h*.74,-y*d*.08],i%2?mats.white:mats.steel); torus(m,`washer-door-${y}-${i}`,Math.min(w*.07,h*.18),.08,[x,h*.38+y*h*.74,d*.29-y*d*.08],mats.glass); }
      box(m,'rent-counter',[w*.82,h*.58,d*.45],[0,h*.29,-d*.34],a);
      sign(m,'rent-sign',[w*.48,1.15],[0,h*.48,d*.24]);
      break;
    }
    case 'couch-store': {
      storefront(m,w,h*.72,d*.68,v,a,{wall:mats.pale});
      box(m,'giant-seat',[w*.46,.75,d*.34],[0,h+.25,0],mats.red);
      box(m,'giant-back',[w*.46,1.45,.5],[0,h+1.0,-d*.13],mats.red,R(-.1,0,0));
      box(m,'giant-arm-a',[.62,1.05,d*.36],[-w*.25,h+.45,0],mats.red); box(m,'giant-arm-b',[.62,1.05,d*.36],[w*.25,h+.45,0],mats.red);
      const tags=m.lod===0?5:2; for(let i=0;i<tags;i++) box(m,`payment-tag-${i}`,[.65,.85,.06],[-w*.32+i*w*.64/Math.max(1,tags-1),h*.35,d*.36],i%2?mats.yellow:mats.white,R(0,0,(i-2)*.08));
      break;
    }
    case 'convenience-rotunda': {
      cyl(m,'congress-store',w*.31,w*.36,h*.72,[0,h*.36,0],mats.pale,R(),m.lod===2?10:18);
      cyl(m,'rotunda-dome',0,w*.38,h*.42,[0,h*.92,0],a,R(),m.lod===2?10:18);
      const wings=m.lod===0?4:m.lod===1?3:2;
      for(let i=0;i<wings;i++){ const ang=i*Math.PI*2/wings+v.layout*.15; box(m,`snack-wing-${i}`,[w*.36,h*.42,d*.28],[Math.cos(ang)*w*.3,h*.21,Math.sin(ang)*d*.3],i%2?mats.red:mats.blue,R(0,-ang,0)); }
      canopy(m,w*.58,d*.28,h*.64,d*.55,mats.yellow,4);
      poleSign(m,v,v.side*w*.46,-d*.4,6.2+v.layout*.4);
      break;
    }
    default: throw new Error(`Unknown commercial kind: ${spec.kind}`);
  }
  stateMarker(m, v, w, d, a);
  return m.group;
}

const defs = [
  ['curb-crave','Curb Crave','The window is faster than cooking and only three lanes from freedom.','Meals arrive in thirty seconds; the traffic study arrives never.',['CURB CRAVE','IDLE. ORDER. REPEAT.'],['drive-thru','food'],'drive-loop',12,8,4,'paint-red'],
  ['lane-lord-burgers','Lane Lord Burgers','A crown-shaped burger keep ruling its private turn lane.','Have it the landlord’s way, with mandatory parking.',['LANE LORD','RULE THE DRIVE-THRU'],['drive-thru','burgers'],'burger-tower',12,9,4.2,'paint-yellow'],
  ['waffle-index','Waffle Index','The diner economists watch when every other indicator has failed.','If the lights go dark, seek higher ground.',['WAFFLE INDEX','OPEN THROUGH MOST EVENTS'],['diner','disaster'],'waffle-diner',15,7,4,'paint-yellow'],
  ['donut-deposition','Donut Deposition','Sworn testimony, glazed hourly.','The sprinkles are admissible and the coffee knows counsel.',['DONUT DEPOSITION','OBJECTION: DELICIOUS'],['donuts','drive-thru'],'donut-ring',11,8,4,'paint-orange'],
  ['coffee-covenant','Coffee Covenant','A giant cup where every beverage renews automatically.','By sipping you accept binding foam arbitration.',['COFFEE COVENANT','TERMS APPLY TO REFILLS'],['coffee','subscription'],'coffee-cup',10,9,5,'paint-teal'],
  ['daiquiri-dash','Daiquiri Dash','Frozen drinks through a window wide enough for poor judgment.','No need to leave the vehicle or reconsider anything.',['DAIQUIRI DASH','KEEP BOTH HANDS SOMEWHERE'],['drive-thru','drinks'],'daiquiri-cup',9,8,5,'paint-orange'],
  ['brisket-bunker','Brisket Bunker','A fortified smokehouse with a defensible sauce perimeter.','Prepared for twelve winters or one lunch rush.',['BRISKET BUNKER','SMOKE IS OUR MOAT'],['restaurant','bbq'],'smokehouse',14,10,5,'paint-red'],
  ['gas-guzzler-gulch','Gas Guzzler Gulch','A pump fort for motorists bravely fleeing the next pump.','Every gallon earns one point toward another gallon.',['GUZZLER GULCH','PREMIUM FREEDOM'],['gas','fuel'],'fuel-fort',18,12,5,'paint-red'],
  ['octane-oasis','Octane Oasis','A palm-shaded mirage with six grades of the same commute.','Hydration costs extra; windshield squeegees are aspirational.',['OCTANE OASIS','PARADISE PER GALLON'],['gas','oasis'],'oasis-station',17,12,5,'paint-teal'],
  ['wash-n-worship','Wash N Worship','An express tunnel cleansing paint and conscience alike.','Unlimited grace, billed monthly, underbody rinse excluded.',['WASH N WORSHIP','REDEEM YOUR CLEARCOAT'],['car-wash','subscription'],'wash-tunnel',12,18,5,'paint-blue'],
  ['chrome-confessional','Chrome Confessional','A steepled wash where road salt tells all.','Pull forward slowly and disclose your premium package.',['CHROME CONFESSIONAL','ABSOLUTION + TIRE SHINE'],['car-wash','satire'],'wash-chapel',12,16,6,'paint-teal'],
  ['lease-eagle-motors','Lease Eagle Motors','Glass wings and flags make every 84-month promise soar.','The bird of prey approves nearly everyone.',['LEASE EAGLE','84 MONTHS OF LIBERTY'],['cars','dealership'],'dealership',20,13,6,'paint-blue'],
  ['repo-ranch','Repo Ranch','A scenic pasture where yesterday’s dreams wait behind chain link.','Come see your old car thriving upstate.',['REPO RANCH','WE FOUND YOUR FREEDOM'],['cars','finance'],'repo-yard',18,14,6,'paint-orange'],
  ['strip-mall-of-duty','Strip Mall of Duty','Six storefronts answer the call of quarterly leasing.','Deploy nail salons until the tax base is secure.',['STRIP MALL OF DUTY','LEASE. SERVE. REPEAT.'],['strip-mall','retail'],'strip',22,10,5,'paint-red'],
  ['popup-afterlife','Popup Afterlife','A seasonal retail spirit possessing whatever died here last.','The lease is temporary; the polyester cobwebs are eternal.',['POPUP AFTERLIFE','BACK FROM THE VACANCY'],['popup','seasonal'],'popup-tent',16,12,6,'paint-orange'],
  ['boxzilla-bargains','Boxzilla Bargains','A retail monster that feeds on little downtowns.','It came from beyond the bypass with everyday low consequences.',['BOXZILLA','DEVOUR THE SAVINGS'],['big-box','retail'],'monster-box',26,18,8,'paint-red'],
  ['bulkhead-club','Bulkhead Club','A barrel-roof warehouse selling mayonnaise by the drum.','Membership proves you can save money by spending four hundred dollars.',['BULKHEAD CLUB','PALLETS OF VALUE'],['warehouse-retail','bulk'],'bulk-barrel',25,18,8,'paint-blue'],
  ['tractor-therapy','Tractor Therapy','Retail counseling measured in horsepower and cup holders.','Ask your dealer if a compact utility tractor is right for your feelings.',['TRACTOR THERAPY','MOW THROUGH IT'],['farm-retail','tractors'],'tractor-silo',18,13,6,'paint-yellow'],
  ['mattress-mitosis','Mattress Mitosis','One bedding store divides into two when nobody is looking.','Scientists still cannot locate a customer.',['MATTRESS MITOSIS','NOW OPEN ACROSS THE STREET'],['mattress','retail'],'twin-mattress',20,11,5,'paint-blue'],
  ['payday-patriot','Payday Patriot','A financial bunker defending tomorrow’s check from tomorrow.','APR is just freedom expressed as three digits.',['PAYDAY PATRIOT','389% FREE ENTERPRISE'],['loans','finance'],'payday-vault',11,9,5,'paint-yellow'],
  ['premium-denied','Premium Denied','An insurance office sheltered by a very selective umbrella.','Coverage begins immediately after the event you needed covered.',['PREMIUM DENIED','WE EXCLUDE YOUR CONCERN'],['insurance','finance'],'umbrella-office',12,9,5,'paint-red'],
  ['copay-castle','Copay Castle','Urgent care with battlements against ordinary deductibles.','Walk in worried, ride out with a payment plan.',['COPAY CASTLE','FEEL BETTER FINANCIALLY'],['medical-retail','urgent-care'],'urgent-cross',15,10,6,'paint-red'],
  ['wallet-er','Wallet ER','A freestanding emergency room specializing in acute liquidity.','The helicopter pad is for your deductible.',['WALLET ER','BILLING IS TRIAGE'],['medical-retail','emergency'],'wallet-er',20,14,8,'paint-red'],
  ['smile-finance','Smile Finance','A tooth-shaped clinic extracting anxiety in easy installments.','Zero pain today, zero percent for six months, several surprises later.',['SMILE FINANCE','BITE-SIZED PAYMENTS'],['medical-retail','dentist'],'tooth-clinic',13,10,6,'paint-teal'],
  ['subscription-station','Subscription Station','A ring of kiosks enrolling daily life one recurring fee at a time.','Cancel anytime after locating the unmarked basement fax machine.',['SUBSCRIPTION STATION','OWN NOTHING MONTHLY'],['subscription','retail'],'subscription-kiosk',15,13,6,'paint-orange'],
  ['forever-box-storage','Forever Box Storage','Climate-controlled rooms for things you forgot you financed.','First month free; remaining decades build character.',['FOREVER BOX','YOUR STUFF LIVES HERE'],['self-storage','subscription'],'storage-rows',22,18,5,'paint-orange'],
  ['parcel-panic','Parcel Panic','A delivery depot where boxes sprint and humans apologize.','Same-day expectations, eventually-day staffing.',['PARCEL PANIC','ARRIVING BY 10 PMISH'],['delivery','logistics'],'parcel-depot',24,16,7,'paint-orange'],
  ['porch-pirate-proof','Porch Pirate Proof','A locker hive promising secure custody of impulse purchases.','Your package is safe in locker QZ-47 behind the old tire store.',['PORCH PIRATE PROOF','CODE EXPIRED'],['delivery','lockers'],'locker-hive',13,7,6,'paint-yellow'],
  ['ghost-kitchen-carousel','Ghost Kitchen Carousel','One kitchen rotating through forty-seven restaurant identities.','Tonight the same fryer is Tuscan, Korean, and wings.',['GHOST KITCHEN','47 BRANDS · 1 FRYER'],['delivery','food'],'ghost-kitchen',18,12,6,'paint-teal'],
  ['appetite-dispatch','Appetite Dispatch','A command tower directing burritos through hostile traffic.','Your driver is approaching, circling, and approaching again.',['APPETITE DISPATCH','TACTICAL TAKEOUT'],['delivery','apps'],'dispatch-tower',14,12,7,'paint-blue'],
  ['return-to-sender-outlet','Return to Sender Outlet','A giant funnel converting buyer’s remorse into store credit.','Every open box gets a second chance and a third barcode.',['RETURN TO SENDER','REGRET, REPRICED'],['returns','outlet'],'return-funnel',16,12,6,'paint-orange'],
  ['loyalty-lab','Loyalty Lab','A retail laboratory isolating the rewards center of the brain.','Earn ten thousand points toward one emotionally significant coupon.',['LOYALTY LAB','WE STUDY YOUR WALLET'],['loyalty','retail'],'loyalty-lab',15,11,6,'paint-teal'],
  ['rent-a-life','Rent A Life','A tower of appliances available one week at a time forever.','Why own a washer once when you can buy it every year?',['RENT A LIFE','WEEKLY FOREVER'],['rent-to-own','appliances'],'appliance-stack',15,12,6,'paint-red'],
  ['buy-now-cry-later','Buy Now Cry Later','A furniture showroom crowned by the couch that owns you.','Take the sectional home today; process the sectional emotionally tomorrow.',['BUY NOW CRY LATER','SOFA SO GOOD'],['furniture','finance'],'couch-store',19,13,6,'paint-red'],
  ['convenience-congress','Convenience Congress','A snack rotunda where every aisle passes its own spending bill.','Open all night and filibustering the hot roller since Tuesday.',['CONVENIENCE CONGRESS','THE AYES HAVE IT'],['convenience','retail'],'convenience-rotunda',17,14,7,'paint-yellow'],
];

export const families = defs.map(([id,label,description,satire,signLines,tags,kind,w,d,h,accent]) => ({
  id, label, category: 'commerce', description, satire, signLines, tags,
  create(variant, lod) { return build({ id, kind, w, d, h, accent }, variant, lod); },
}));
