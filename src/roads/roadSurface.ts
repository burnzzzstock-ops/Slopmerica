import * as THREE from 'three';
import { clamp, closestOnSampled, lerp, locate } from '../core/math';
import { mulberry32 } from '../core/rng';
import type { WorldFields } from '../contracts';
import type { RoadNetwork, RSeg } from './network';
import { carriageHalf, ROAD_TYPES } from './roadTypes';
import { endCapRadius, SURF_LIFT } from './roadSection';
import { visualTrim } from './roadJunction';

type Binding = { state: THREE.BufferAttribute; ids: Uint32Array; weights: Float32Array };
type Sample = { id: number; weight: number; dip: number; stop: number };
type Bounds = { minX:number; minZ:number; maxX:number; maxZ:number };

function heightAt(segment: RSeg, distance: number): number {
  const { i, f } = locate(segment.samp, clamp(distance, 0, segment.length));
  return lerp(segment.hs[i], segment.hs[i + 1], f);
}

/** Real longitudinal depressions retain water. A flat grade or crest returns zero. */
export function roadDepression(segment: RSeg, distance: number): number {
  if (distance < 12 || distance > segment.length - 12) return 0;
  const before = heightAt(segment, distance - 12);
  const here = heightAt(segment, distance);
  const after = heightAt(segment, distance + 12);
  const grade = Math.abs(after - before) / 24;
  return clamp(((before + after) * .5 - here) / .3, 0, 1) * (1 - clamp((grade - .015) / .045, 0, 1));
}

/** Rendering attributes sampled from roads in 3D, so a bridge keeps its own age and drainage. */
export class RoadSurfaceState {
  readonly uniforms = {
    uRoadWet: { value: 0 },
    uRoadSky: { value: new THREE.Color(0x74899d) },
    uRoadHasEnvironment: { value: 0 },
  };
  private provider?: WorldFields['roadCondition'];
  private conditions = new Map<number, number>();
  private bindings: Binding[] = [];
  private stops = new Map<number, readonly [number, number]>();
  private samples = new Map<string, { x:number; z:number; values:Sample[] }>();
  private bounds = new Map<number, Bounds>();

  constructor(private net: RoadNetwork) {
    for (const event of ['segAdded','segChanged','segTrimmed','segRemoved'] as const) {
      net.events.on(event, segment => {
        const prior = this.bounds.get(segment.id) ?? segment;
        this.invalidateSamples({
          minX:Math.min(prior.minX,segment.minX), minZ:Math.min(prior.minZ,segment.minZ),
          maxX:Math.max(prior.maxX,segment.maxX), maxZ:Math.max(prior.maxZ,segment.maxZ),
        });
      });
    }
    net.events.on('nodeChanged', node => this.invalidateSamples({minX:node.x,minZ:node.z,maxX:node.x,maxZ:node.z}));
  }

  private invalidateSamples(bounds: Bounds) {
    for (const [key,sample] of this.samples) {
      if (sample.x >= bounds.minX-64 && sample.x <= bounds.maxX+64 &&
          sample.z >= bounds.minZ-64 && sample.z <= bounds.maxZ+64) this.samples.delete(key);
    }
  }

  setProvider(provider: WorldFields['roadCondition']) {
    this.provider = provider;
    this.conditions.clear();
  }

  resetGeometry() {
    this.bindings.length = 0;
    this.stops.clear();
    this.bounds.clear();
    for (const segment of this.net.segs.values()) {
      this.bounds.set(segment.id, {minX:segment.minX,minZ:segment.minZ,maxX:segment.maxX,maxZ:segment.maxZ});
      const at = (nodeId: number) => (this.net.nodes.get(nodeId)?.segs.length ?? 0) >= 3
        ? visualTrim(this.net, segment, nodeId) + 7 : Infinity;
      this.stops.set(segment.id, [at(segment.a), at(segment.b)]);
    }
  }

  /** Reads cheap scalar contracts each frame, and uploads only at a 1/255 change. */
  update() {
    let changed = false;
    for (const id of this.conditions.keys()) if (!this.net.segs.has(id)) this.conditions.delete(id);
    for (const segment of this.net.segs.values()) {
      const supplied = this.provider?.(segment.id) ?? 1;
      const condition = Number.isFinite(supplied) ? Math.round(clamp(supplied, 0, 1) * 255) : 255;
      if (condition !== this.conditions.get(segment.id)) changed = true;
      this.conditions.set(segment.id, condition);
    }
    if (!changed) return;
    for (const binding of this.bindings) this.writeConditions(binding);
  }

  attach(geometry: THREE.BufferGeometry) {
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    const state = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
    state.setUsage(THREE.DynamicDrawUsage);
    const binding = { state, ids: new Uint32Array(positions.count * 3), weights: new Float32Array(positions.count * 3) };
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const samples = this.samplesAt(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
      const weight = samples.reduce((sum, sample) => sum + sample.weight, 0);
      let dip = 0, stop = 0;
      for (let slot = 0; slot < samples.length; slot++) {
        const sample = samples[slot], normalized = sample.weight / weight;
        binding.ids[vertex * 3 + slot] = sample.id;
        binding.weights[vertex * 3 + slot] = normalized;
        dip += sample.dip * normalized;
        stop += sample.stop * normalized;
      }
      state.setXYZ(vertex, 1, dip, stop);
    }
    this.writeConditions(binding);
    this.bindings.push(binding);
    geometry.setAttribute('aRoadState', state);
  }

  private writeConditions(binding: Binding) {
    for (let vertex = 0; vertex < binding.state.count; vertex++) {
      let condition = 0, weight = 0;
      for (let slot = 0; slot < 3; slot++) {
        const offset = vertex * 3 + slot, share = binding.weights[offset];
        condition += (this.conditions.get(binding.ids[offset]) ?? 255) / 255 * share;
        weight += share;
      }
      binding.state.setX(vertex, weight > 0 ? condition / weight : 1);
    }
    binding.state.needsUpdate = true;
  }

  private samplesAt(x: number, y: number, z: number): Sample[] {
    // Road condition changes over blocks and drainage over a 24 m span. Reuse
    // a 4 m horizontal, 0.5 m vertical sample across nearby ribbon vertices.
    // The height dimension keeps overpasses separate from the road below.
    x = Math.round(x / 4) * 4;
    y = Math.round(y * 2) / 2;
    z = Math.round(z / 4) * 4;
    const key = `${x},${y},${z}`, cached = this.samples.get(key);
    if (cached) return cached.values;
    const samples: Sample[] = [];
    for (const segment of this.net.segsNear(x - 48, z - 48, x + 48, z + 48)) {
      if (segment.type === 'gravel') continue;
      const closest = closestOnSampled({ x, z }, segment.samp);
      const height = heightAt(segment, closest.s) + SURF_LIFT;
      let vertical = Math.abs(height - y);
      // End caps and junction hulls sit at their node's height. On a steep
      // approach the closest centreline sample can be several metres higher.
      for (const id of [segment.a, segment.b]) {
        const node = this.net.nodes.get(id);
        if (!node) continue;
        const radius = node.segs.length === 1 ? endCapRadius(ROAD_TYPES[segment.type]) : ROAD_TYPES[segment.type].width / 2;
        // A 4 m cache cell can displace the sample by half its diagonal.
        if (Math.hypot(node.x - x, node.z - z) <= radius + Math.SQRT2 * 2) {
          vertical = Math.min(vertical, Math.abs(node.y + SURF_LIFT - y));
        }
      }
      // Roads crossing at different elevations must keep independent conditions.
      if (vertical > 2) continue;
      const edgeDistance = Math.max(0, closest.d - carriageHalf(ROAD_TYPES[segment.type]));
      const distance = edgeDistance + vertical * 4;
      if (distance > 40) continue;
      const stops = this.stops.get(segment.id) ?? [Infinity, Infinity];
      const stopDistance = Math.min(Math.abs(closest.s - stops[0]), Math.abs(segment.length - closest.s - stops[1]));
      const stop = 1 - Math.min(1, stopDistance / 7);
      samples.push({ id:segment.id, weight:1 / (1 + distance * distance), dip:roadDepression(segment, closest.s), stop });
    }
    const nearest = samples.sort((a, b) => b.weight - a.weight || a.id - b.id).slice(0, 3);
    this.samples.set(key, { x,z,values:nearest });
    return nearest;
  }
}

/** Shared world-space masks. Red is tar, green is sealed patches, blue is puddle breakup. */
export function roadWearTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#000'; context.fillRect(0, 0, 512, 512);
  const random = mulberry32(0x5a17face);
  context.lineJoin = context.lineCap = 'round';
  // Periodic snakes meet their opposite edge with the same position and tangent.
  for (let crack = 0; crack < 12; crack++) {
    const horizontal = crack % 2 === 0, base = random() * 512, phase = random() * Math.PI * 2;
    for (const offset of [-512, 0, 512]) {
      context.beginPath();
      for (let along = 0; along <= 512; along += 4) {
        const across = base + offset + Math.sin(along / 512 * Math.PI * 4 + phase) * 12 + Math.sin(along / 512 * Math.PI * 10 + phase) * 3;
        const x = horizontal ? along : across, y = horizontal ? across : along;
        if (along === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = '#b80000'; context.lineWidth = 2.2; context.stroke();
    }
  }
  for (let patch = 0; patch < 9; patch++) {
    const x = random() * 512, y = random() * 512, width = 22 + random() * 65, height = 20 + random() * 80;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      context.fillStyle = '#003a00'; context.fillRect(x + dx, y + dy, width, height);
      context.strokeStyle = '#00bc00'; context.lineWidth = 2; context.strokeRect(x + dx, y + dy, width, height);
    }
  }
  const pixels = context.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const wave = Math.sin(x / 512 * Math.PI * 6) * Math.cos(y / 512 * Math.PI * 4)
      + .45 * Math.sin((x + y) / 512 * Math.PI * 10);
    pixels.data[(y * 512 + x) * 4 + 2] = Math.round(clamp(.5 + wave * .32, 0, 1) * 255);
  }
  context.putImageData(pixels, 0, 0);
  // Three assigns texture UUIDs from Math.random. Keep those draws in this art's
  // local stream as well, preserving the caller's simulation/random sequence.
  const previousRandom = Math.random;
  try {
    Math.random = random;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
  } finally { Math.random = previousRandom; }
}
