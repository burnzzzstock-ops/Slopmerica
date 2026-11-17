import type { BuildingModel } from '../contracts';

/** A cosmetic signature for a retired brand that now falls back to a tower.
 * It does not take another draw from the model's seeded random stream. */
export function towerBrandScale(brand: string): number {
  let hash = 2166136261;
  for (let i = 0; i < brand.length; i++) hash = Math.imul(hash ^ brand.charCodeAt(i), 16777619);
  return 0.92 + (hash >>> 0) / 0xffffffff * 0.16;
}

/** Refit the caller's existing copy above its three-storey street wall.
 * Geometry counts, ground-floor entrances, parking and labels stay unchanged. */
export function stretchTowerCrown(model: BuildingModel, scale: number): BuildingModel {
  if (model.height <= 35) return model;
  const geometry = model.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y <= 12) continue;
    position.setY(i, 12 + (y - 12) * scale);
    const nx = normal.getX(i), ny = normal.getY(i) / scale, nz = normal.getZ(i);
    const length = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(i, nx / length, ny / length, nz / length);
  }
  position.needsUpdate = normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  model.height = 12 + (model.height - 12) * scale;
  for (const emitter of model.emitters) {
    if (emitter.pos[1] > 12) emitter.pos[1] = 12 + (emitter.pos[1] - 12) * scale;
  }
  return model;
}
