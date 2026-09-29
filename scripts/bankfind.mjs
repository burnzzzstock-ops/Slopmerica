// Bank finding for shoreshots.mjs and shoretest.mjs: runs inside the page (pass bankTools.toString() to page.evaluate and
// call it with the terrain).
// A bank point is a point on the waterline (the ground crossing the water level, bisected out along x between two samples 6 m
// apart) with the slope measured THERE (the gradient over 3 m centred on the contour), not at the sample it was found from
// (which is on the flat bed or the flat bank, and made steep banks look gentle).
//   points({ minSlope, maxSlope })      every waterline point on the map (a 6 m scan) with a slope in the range
//   find(S, { coast, maxSlope })        the nearest bank to the start whose slope is at most maxSlope and whose next 60 m
//                                       along the waterline (seven points 10 m apart, each found again along the bank's
//                                       normal) are the same kind of bank; null if there is none. coast: only where the map's
//                                       own sand function says beach
export function bankTools(T) {
  // along the normal (nx, nz) through (px, pz): where the ground crosses the water level within 14 m
  const contourAt = (px, pz, nx, nz) => {
    let prev = T.h(px - nx * 14, pz - nz * 14);
    for (let t = -13; t <= 14; t++) {
      const cur = T.h(px + nx * t, pz + nz * t);
      if ((prev < 0) !== (cur < 0)) {
        let a = t - 1, b = t, ha = prev;
        for (let it = 0; it < 24; it++) { const m = (a + b) / 2, hm = T.h(px + nx * m, pz + nz * m); if ((hm < 0) === (ha < 0)) { a = m; ha = hm; } else b = m; }
        const x = px + nx * a, z = pz + nz * a;
        const gx = (T.h(x + 1.5, z) - T.h(x - 1.5, z)) / 3, gz = (T.h(x, z + 1.5) - T.h(x, z - 1.5)) / 3, sl = Math.hypot(gx, gz);
        return { x, z, sl, nx: gx / (sl || 1), nz: gz / (sl || 1) };
      }
      prev = cur;
    }
    return null;
  };
  const scan = (x0, x1, z0, z1, keep) => {
    const out = [];
    for (let z = z0; z <= z1; z += 6)
      for (let x = x0; x <= x1; x += 6) {
        if ((T.h(x, z) < 0) === (T.h(x + 6, z) < 0)) continue;
        const c = contourAt(x + 3, z, 1, 0);
        if (c && keep(c)) out.push(c);
      }
    return out;
  };
  return {
    contourAt,
    points: (o) => scan(-3000, 3000, -3000, 3000, (c) => c.sl >= o.minSlope && c.sl <= o.maxSlope),
    find: (S, o) => {
      const reach = o.coast ? 4500 : 1500;
      const cands = scan(Math.max(-3000, S.x - reach), Math.min(3000, S.x + reach), Math.max(-3000, S.z - reach), Math.min(3000, S.z + reach),
        (c) => c.sl >= 1 / 50 && c.sl <= o.maxSlope && (!o.coast || (T.map.sand && T.map.sand(c.x, c.z) > 0.4)));
      for (const c of cands) c.d = Math.hypot(c.x - S.x, c.z - S.z);
      cands.sort((p, q) => p.d - q.d);
      for (let n = 0; n < cands.length && n < 600; n++) {
        const c = cands[n], tx = -c.nz, tz = c.nx;
        let ok = true;
        for (let k = -3; k <= 3 && ok; k++) {
          const q = contourAt(c.x + tx * k * 10, c.z + tz * k * 10, c.nx, c.nz);
          if (!q || q.sl < 1 / 60 || q.sl > o.maxSlope * 1.5) ok = false;
        }
        if (ok) return c;
      }
      return null;
    },
  };
}
