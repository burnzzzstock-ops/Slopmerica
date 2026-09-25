// Isolated renderer galleries for art review. Each gallery is created once per Game.
import * as THREE from 'three';
import type { Game } from '../game';
import type { PersonAction, VehicleKind } from '../contracts';
import { ARCHETYPES, PeopleRenderer } from '../agents/people';
import { VEHICLE_SPECS, VehicleRenderer } from '../agents/vehicles';
import { AmbientLife } from '../agents/ambient';

const ACTIONS: PersonAction[] = ['walk', 'run', 'idle', 'smoke', 'drink', 'vape', 'phone', 'protest', 'dance', 'drum', 'yoga', 'sit', 'lie', 'fight'];
const PAINT = [0xc8c9c3, 0x52677a, 0xa52a2a, 0x34443d, 0xb7a581, 0x60636a];

function flatY(g: Game, x: number, z: number, halfX: number, halfZ: number): number {
  let y = g.terrain.h(x, z);
  for (let dz = -halfZ; dz <= halfZ; dz += 12) {
    for (let dx = -halfX; dx <= halfX; dx += 12) {
      y = Math.max(y, g.terrain.h(x + dx, z + dz));
    }
  }
  return y + 0.15;
}

function pad(g: Game, x: number, y: number, z: number, width: number, depth: number): THREE.Mesh {
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.22, depth),
    new THREE.MeshStandardMaterial({ color: 0x333940, roughness: 0.9, metalness: 0.05 }),
  );
  slab.position.set(x, y - 0.11, z);
  slab.receiveShadow = true;
  g.scene.add(slab);
  g.trees.cut(x - width / 2 - 3, z - depth / 2 - 3, x + width / 2 + 3, z + depth / 2 + 3, () => true);
  return slab;
}

function label(text: string, x: number, y: number, z: number, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#131820';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#c6f432';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48, 492);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.position.set(x, y, z);
  sprite.scale.set(width, width * 96 / 512, 1);
  return sprite;
}

export function agentShowcase(g: Game) {
  const kinds = Object.keys(VEHICLE_SPECS) as VehicleKind[];
  let vehicles: { renderer: VehicleRenderer; handles: number[]; slab: THREE.Mesh; labels: THREE.Sprite[] } | undefined;
  let people: { renderer: PeopleRenderer; handles: number[]; slab: THREE.Mesh; labels: THREE.Sprite[]; x: number; y: number; z: number; t: number } | undefined;
  let ambient: AmbientLife | undefined;

  return {
    vehicleShowcase(x: number, z: number): number {
      const spacing = 13;
      const halfWidth = (kinds.length * spacing) / 2;
      const y = flatY(g, x, z, halfWidth + 5, 8);
      if (!vehicles) {
        const renderer = new VehicleRenderer(g.scene, kinds.length);
        vehicles = { renderer, handles: kinds.map((kind, i) => renderer.add(kind, PAINT[i % PAINT.length])), slab: pad(g, x, y, z, halfWidth * 2 + 12, 15), labels: [] };
        g.onFrame.push(() => renderer.setNight(g.env.night));
        for (let i = 0; i < kinds.length; i++) {
          const sprite = label(VEHICLE_SPECS[kinds[i]].label, x + (i - (kinds.length - 1) / 2) * spacing, y + 4.8, z - 5, 10);
          g.scene.add(sprite);
          vehicles.labels.push(sprite);
        }
      } else {
        vehicles.slab.position.set(x, y - 0.11, z);
        g.trees.cut(x - halfWidth - 8, z - 10, x + halfWidth + 8, z + 10, () => true);
      }
      for (let i = 0; i < kinds.length; i++) {
        const px = x + (i - (kinds.length - 1) / 2) * spacing;
        vehicles.renderer.set(vehicles.handles[i], px, y, z, 0);
        vehicles.labels[i].position.set(px, y + 4.8, z - 5);
      }
      vehicles.renderer.flush();
      g.frame(0.016);
      return kinds.length;
    },

    peopleShowcase(x: number, z: number): number {
      const cols = 10;
      const rows = Math.ceil(ARCHETYPES.length / cols);
      const width = cols * 4.4 + 6;
      const depth = rows * 5 + 5;
      const y = flatY(g, x, z, width / 2, depth / 2);
      if (!people) {
        const renderer = new PeopleRenderer(g.scene, ARCHETYPES.length);
        const handles = ARCHETYPES.map((_, i) => renderer.add(i, i * 3761 + 17));
        people = { renderer, handles, slab: pad(g, x, y, z, width, depth), labels: [], x, y, z, t: 0 };
        for (let i = 0; i < ARCHETYPES.length; i++) {
          const col = i % cols, row = Math.floor(i / cols);
          const sprite = label(ARCHETYPES[i].name, x + (col - (cols - 1) / 2) * 4.4, y + 2.9, z + (row - (rows - 1) / 2) * 5 - 1.2, 3.8);
          g.scene.add(sprite);
          people.labels.push(sprite);
        }
        g.onFrame.push(dt => {
          if (!people) return;
          people.t += dt;
          people.renderer.setNight(g.env.night);
          for (let i = 0; i < people.handles.length; i++) {
            const col = i % cols, row = Math.floor(i / cols);
            const px = people.x + (col - (cols - 1) / 2) * 4.4;
            const pz = people.z + (row - (rows - 1) / 2) * 5;
            const action = ACTIONS[(Math.floor(people.t / 3) + i) % ACTIONS.length];
            people.renderer.set(people.handles[i], px, people.y, pz, 0, action, people.t * 4 + i * .3);
          }
          people.renderer.flush();
        });
      }
      people.x = x; people.y = y; people.z = z;
      people.slab.position.set(x, y - 0.11, z);
      g.trees.cut(x - width / 2 - 3, z - depth / 2 - 3, x + width / 2 + 3, z + depth / 2 + 3, () => true);
      for (let i = 0; i < people.labels.length; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        people.labels[i].position.set(x + (col - (cols - 1) / 2) * 4.4, y + 2.9, z + (row - (rows - 1) / 2) * 5 - 1.2);
      }
      g.frame(0.016);
      return ARCHETYPES.length;
    },

    ambientShowcase(x: number, z: number): number {
      if (!ambient) {
        ambient = new AmbientLife(g.scene, g.terrain, g.opts.map, g.q);
        g.onFrame.push(dt => ambient?.update(dt, g.rts.target, g.env.night, g.weather));
      }
      const count = ambient.showcase(x, z);
      g.frame(0.016);
      return count;
    },
  };
}
