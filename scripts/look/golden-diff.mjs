// This function also runs in the browser. Compare opaque sRGB PNGs in CIE Lab (D65).
export function comparePixels(before, after, pixelThreshold = 3) {
  if (!before.length || before.length !== after.length || before.length % 4) throw new Error('RGBA image sizes differ');
  const linear = Float64Array.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = v => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  function lab(data, i, out) {
    const r = linear[data[i]], g = linear[data[i + 1]], b = linear[data[i + 2]];
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    out[0] = 116 * y - 16;
    out[1] = 500 * (x - y);
    out[2] = 200 * (y - z);
  }
  const a = [0, 0, 0], b = [0, 0, 0];
  const diff = new Uint8ClampedArray(before.length);
  let changed = 0, exactDifferences = 0;
  for (let i = 0; i < before.length; i += 4) {
    diff[i + 3] = 255;
    if (before[i + 3] !== 255 || after[i + 3] !== 255) throw new Error('Expected an opaque game frame');
    if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
    exactDifferences++;
    lab(before, i, a);
    lab(after, i, b);
    const delta = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (delta > pixelThreshold) {
      changed++;
      diff[i] = 255;
      diff[i + 1] = Math.min(255, Math.round(delta * 4));
    }
  }
  const total = before.length / 4;
  return { total, changed, exactDifferences, failed: changed / total > 0.005, diff };
}
