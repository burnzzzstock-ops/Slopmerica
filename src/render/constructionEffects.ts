import * as THREE from 'three';
import type { Game } from '../game';
import type { WorldEvents } from '../contracts';
import { hash2 } from '../core/rng';
import { withBuildingLodRandom as withVisualRandom } from './buildingLod';

const MAX_PILES = 16;
const PIECES = 6;
const LIFE = 6;
type Pile = { id: number; x: number; y: number; z: number; width: number; depth: number; age: number };

function rubbleGeometry() {
  const outline = [[-.55, -.28], [-.18, -.52], [.44, -.38], [.6, .22], [.16, .52], [-.5, .36]];
  const tops = [.4, .55, .28, .45, .62, .38];
  const points = outline.map(([x, z]) => [x, -.3, z]);
  for (let i = 0; i < outline.length; i++) points.push([outline[i][0] * .9, tops[i] - .3, outline[i][1] * .9]);
  const positions: number[] = [];
  const triangle = (a: number, b: number, c: number) => positions.push(...points[a], ...points[b], ...points[c]);
  for (let i = 1; i < 5; i++) {
    triangle(0, i, i + 1);
    triangle(6, i + 7, i + 6);
  }
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    triangle(i, i + 6, next + 6);
    triangle(i, next + 6, next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Construction feedback consumes typed world events and owns only temporary
 * draws. The simulation is already complete before any effect is created. */
export class ConstructionEffects {
  private piles: Pile[] = [];
  readonly rubble: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private angles = new THREE.Euler();
  private color = new THREE.Color();

  constructor(private game: Game) {
    this.rubble = withVisualRandom(() => new THREE.InstancedMesh(
      rubbleGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98 }),
      MAX_PILES * PIECES,
    ));
    this.rubble.name = 'temporary-building-rubble';
    this.rubble.count = 0;
    this.rubble.visible = false;
    this.rubble.castShadow = true;
    this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    game.scene.add(this.rubble);
    game.sim.events.on('construction', event => this.completed(event));
    game.sim.events.on('demolished', event => this.demolished(event));
  }

  private near(x: number, y: number, z: number) {
    return this.game.camera.position.distanceToSquared(this.position.set(x, y, z)) < 700 * 700;
  }

  private completed(event: WorldEvents['construction']) {
    if (event.progress !== 1) return;
    const building = this.game.buildings.list.get(event.bldId);
    if (!building || !this.near(building.x, building.y, building.z)) return;
    withVisualRandom(() => this.game.particles.emit('dust', building.x, building.y, building.z, {
      count: 12,
      spread: Math.min(5, building.hw * 0.45),
      size: 0.55,
      life: 1.4,
    }));
  }

  private demolished(event: WorldEvents['demolished']) {
    const y = this.game.terrain.h(event.x, event.z);
    if (!this.near(event.x, y, event.z)) return;
    this.game.buildings.beginDemolition(event.bldId);
    if (this.piles.length >= MAX_PILES) this.piles.shift();
    this.piles.push({ id: event.bldId, x: event.x, y, z: event.z, width: event.w, depth: event.d, age: 0 });
    withVisualRandom(() => this.game.particles.emit('dust', event.x, y, event.z, {
      count: 24,
      spread: Math.min(8, Math.max(event.w, event.d) * 0.25),
      size: 0.8,
      life: 2.6,
    }));
  }

  update(dt: number) {
    this.game.buildings.updateVisuals(dt);
    let count = 0;
    for (let i = this.piles.length - 1; i >= 0; i--) {
      const pile = this.piles[i];
      pile.age += Math.max(0, dt);
      if (pile.age >= LIFE) {
        this.piles.splice(i, 1);
        continue;
      }
      const reveal = THREE.MathUtils.smoothstep(pile.age, 0.35, 0.65);
      const clear = 1 - THREE.MathUtils.smoothstep(pile.age, LIFE - 1.5, LIFE);
      const amount = reveal * clear;
      if (amount <= 0) continue;
      for (let part = 0; part < PIECES; part++) {
        const x = (hash2(pile.id, part, 91) - 0.5) * pile.width * 0.3;
        const z = (hash2(pile.id, part, 92) - 0.5) * pile.depth * 0.3;
        const size = 1.1 + hash2(pile.id, part, 93) * 1.8;
        this.scale.set(size * 1.8, size * 0.8, size * 1.3).multiplyScalar(amount);
        this.position.set(pile.x + x, pile.y + this.scale.y * 0.3, pile.z + z);
        this.angles.set((hash2(pile.id, part, 95) - .5) * .3, hash2(pile.id, part, 94) * Math.PI, (hash2(pile.id, part, 96) - .5) * .3);
        this.rotation.setFromEuler(this.angles);
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.rubble.setMatrixAt(count, this.matrix);
        this.color.setHex([0x77786f, 0x9d9588, 0x686e6c][part % 3]);
        this.rubble.setColorAt(count++, this.color);
      }
    }
    this.rubble.count = count;
    this.rubble.visible = count > 0;
    if (count) {
      this.rubble.instanceMatrix.needsUpdate = true;
      if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
    }
  }
}
