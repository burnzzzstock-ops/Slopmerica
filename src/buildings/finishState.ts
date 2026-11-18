import * as THREE from 'three';
import type { Game } from '../game';

/** The batch colour's spare alpha carries visual wear. The vertex shader
 * restores alpha to one before shading. Info-view RGB tint stays independent. */
export class BuildingFinishes {
  private color = new THREE.Vector4();

  update(game: Game) {
    // Instance handles and tint can change within the same day during a level
    // upgrade, info-view change or reload. Check live handles before rendering.
    const buildings = game.buildings;
    for (const building of buildings.list.values()) {
      if (building.inst < 0) continue;
      const age = Math.min(1, game.fields.buildingAge(building.id) / 365);
      const neglect = 1 - THREE.MathUtils.clamp(game.fields.buildingCondition(building.id), 0, 1);
      const value = 1 - Math.min(1, age * 0.35 + neglect * 0.65);
      const mesh = building.zone === 'service' && !building.onMain ? buildings.kitMesh : buildings.mesh;
      mesh.getColorAt(building.inst, this.color);
      if (Math.abs(this.color.w - value) < 1e-5) continue;
      this.color.w = value;
      mesh.setColorAt(building.inst, this.color);
    }
  }
}
