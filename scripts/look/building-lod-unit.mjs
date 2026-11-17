// Geometry-only guards: preserve holes, winding, normalized attributes and source vertices.
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
let bad = 0;
const check = (label, ok) => { console.log(ok ? 'OK' : 'FAIL', label); if (!ok) bad++; };
try {
  const [THREE, { buildingLod, buildingSilhouette, withBuildingLodRandom }, { MB, M }, { T }] = await Promise.all([
    server.ssrLoadModule('three'), server.ssrLoadModule('/src/render/buildingLod.ts'), server.ssrLoadModule('/src/buildings/mesh.ts'), server.ssrLoadModule('/src/art/index.ts'),
  ]);
  const tile = T('concrete');
  const grid = (axis = 2, sign = 1, hole = false) => {
    const p = [], n = [], uv = [], color = [];
    const cells = hole ? [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],[0,0]] : [[0,0],[1,0],[0,1],[1,1]];
    for (const [x, y] of cells) {
      const corners = [[x,y],[x+1,y],[x+1,y+1],[x,y+1]], winding = (axis === 2 ? 1 : -1) * sign;
      for (const k of winding > 0 ? [0,1,2,0,2,3] : [0,2,1,0,3,2]) {
        const v = [0,0,0], normal = [0,0,0]; v[axis === 0 ? 2 : 0] = corners[k][0]; v[axis === 1 ? 2 : 1] = corners[k][1]; normal[axis] = sign;
        p.push(...v); n.push(...normal); uv.push(k === 1 || k === 2 ? tile.u1 : tile.u0, k >= 2 ? tile.v1 : tile.v0); color.push(.5,.6,.7);
      }
    }
    const g = new THREE.BufferGeometry();
    for (const [name, values, size] of [['position',p,3],['normal',n,3],['uv',uv,2],['color',color,3]]) g.setAttribute(name,new THREE.Float32BufferAttribute(values,size));
    return g;
  };
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1,1]) {
    const source = grid(axis, sign), positions = [...source.getAttribute('position').array], g = buildingSilhouette(source);
    const p = g?.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let correct = p?.count === 6;
    if (p) for(let i=0;i<p.count;i+=3) { a.fromBufferAttribute(p,i); b.fromBufferAttribute(p,i+1); c.fromBufferAttribute(p,i+2); b.sub(a).cross(c.sub(a)); correct &&= b.getComponent(axis)*sign > 0; }
    check(`rectangle merges with correct winding, axis ${axis}, sign ${sign}`, correct);
    check('source positions untouched', positions.every((v,i)=>v===source.getAttribute('position').array[i]));
    check('all coarse attributes finite', !!g && Object.values(g.attributes).every(a=>Array.from(a.array).every(Number.isFinite)));
    g?.dispose(); source.dispose();
  }
  const hole = grid(2,1,true);
  check('equal-area overlap cannot fill a hole', buildingSilhouette(hole) === null);
  const warped = grid(); warped.getAttribute('position').setZ(2,.5);
  check('a noncoplanar triangle is not flattened', buildingSilhouette(warped) === null);
  const mixed = grid(); mixed.getAttribute('normal').setZ(2,-1);
  check('a mixed-normal triangle is not flattened', buildingSilhouette(mixed) === null);
  const mb = new MB(); mb.box(-5,5,0,8,-4,4,{side:M('brick',2,2),top:M('flatRoof',4,4)});
  for(let i=0;i<30;i++)mb.box(20+i,20.4+i,0,.5,20,20.4,M('plain',1,1));
  const source = mb.build(), count=source.getAttribute('position').count;
  source.setIndex(Array.from({length:count},(_,i)=>i));
  source.setAttribute('tile',new THREE.Float32BufferAttribute(Array.from({length:count},(_,i)=>i%4),1));
  source.setAttribute('normalized',new THREE.Uint8BufferAttribute(new Uint8Array(count).fill(128),1,true));
  const far = buildingLod(source);
  check('furnishings removed from indexed geometry', !!far && far.index.count < source.index.count*.5);
  check('extra and normalized attributes preserved', !!far?.getAttribute('tile') && Array.from(far.getAttribute('normalized').array).every(v=>Math.abs(v-128/255)<1e-6));
  check('Kit format is not coerced into the atlas silhouette', buildingSilhouette(source) === null);
  const random = Math.random; let draws = 0; const observed = () => { draws++; return .5; }; Math.random = observed;
  try {
    withBuildingLodRandom(() => { buildingLod(source)?.dispose(); withBuildingLodRandom(() => buildingSilhouette(grid())?.dispose()); });
    check('nested proxy work consumes no global RNG draws', draws === 0 && Math.random === observed);
    try { withBuildingLodRandom(() => { throw Error('injected'); }); } catch {}
    check('throwing proxy work restores global RNG', Math.random === observed);
  } finally { Math.random = random; }
} finally { await server.close(); }
process.exitCode = bad ? 1 : 0;
