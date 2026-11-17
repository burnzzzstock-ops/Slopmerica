// Info views use supplied scalar fields, with legacy ribbons and tint as fallbacks.
import * as THREE from 'three';
import type { ExtView } from '../ext/registry';
import { lerp } from '../core/math';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { Game } from '../game';
import type { FieldLegend, InfoViewId, ScalarField } from '../contracts';
import { HALF } from '../config';
import { INFO_OVERLAY } from '../world/terrain';
import { setProblemView } from '../sim/serviceIcons';

export type ViewMode = 'none' | 'traffic' | 'landValue';

const C_GOOD = new THREE.Color(0x3ddc84);
const C_MID = new THREE.Color(0xffd23a);
const C_BAD = new THREE.Color(0xff3b3b);

export type OverlayPalette = 'standard' | 'colorblind';
export interface OverlayLegend extends FieldLegend {
  view: InfoViewId;
  min: number;
  max: number;
  stops: readonly { value: number; color: string }[];
}
const FIELD_IDS: readonly InfoViewId[] = ['traffic', 'landValue', 'power', 'water', 'sewage', 'garbage', 'fire', 'police', 'health', 'education', 'pollution', 'noise', 'valuePerAcre', 'commute', 'roadCondition', 'flood', 'heat'];

/** Palettes and units use the same values as the rendered field. FABLE can use these stops in its legend. */
export function overlayLegend(field: ScalarField, palette: OverlayPalette): OverlayLegend {
  let colors = palette === 'colorblind' ? ['#0072b2', '#f0e6b8', '#d55e00'] : ['#35a66f', '#f3d46b', '#c34851'];
  if (field.legend.ramp === 'goodHigh') colors = colors.slice().reverse();
  if (field.legend.ramp === 'neutral') colors = ['#38568b', '#42a09b', '#ece59b'];
  return { ...field.legend, view: field.view, min: field.min, max: field.max,
    stops: colors.map((color, i) => ({ value: field.min + (field.max - field.min) * i / 2, color })) };
}

/** Bilinear sampling ignores missing cells. A missing cell centre remains unavailable. */
export function sampleOverlayField(field: ScalarField, x: number, z: number): number | null {
  const fx = (x + HALF) / field.cellM - .5, fz = (z + HALF) / field.cellM - .5;
  if (fx < -.5 || fz < -.5 || fx > field.w - .5 || fz > field.h - .5) return null;
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  let sum = 0, weight = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const px = Math.max(0, Math.min(field.w - 1, ix + i)), pz = Math.max(0, Math.min(field.h - 1, iz + j));
    const value = field.data[pz * field.w + px];
    if (!Number.isFinite(value)) continue;
    const w = (i ? tx : 1 - tx) * (j ? tz : 1 - tz);
    sum += value * w; weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export class Overlays {
  mode: ViewMode = 'none';
  /** active extension info view (exclusive with the core modes) */
  ext: ExtView | null = null;
  private traffic: THREE.Mesh;
  private t = 0;
  private field: ScalarField | null = null;
  private fieldTexture: THREE.DataTexture | null = null;
  private palette: OverlayPalette = 'standard';
  private patched = new WeakSet<THREE.Material>();
  private fieldUniforms = {
    uFieldOn: { value: 0 }, tField: { value: null as THREE.Texture | null },
    uFieldExtent: { value: new THREE.Vector2(1, 1) },
    uFieldViewToWorld: { value: new THREE.Matrix4() },
    uFieldLow: { value: new THREE.Color() }, uFieldMid: { value: new THREE.Color() }, uFieldHigh: { value: new THREE.Color() },
  };

  constructor(private game: Game) {
    this.traffic = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 }));
    this.traffic.renderOrder = 4;
    this.traffic.visible = false;
    this.traffic.frustumCulled = false;
    game.scene.add(this.traffic);
    const before = game.scene.onBeforeRender;
    game.scene.onBeforeRender = (...args) => {
      before.apply(game.scene, args);
      // Service systems update after Overlays.update. Bind our field after those
      // legacy writers and before Three projects or uploads this scene.
      this.prepareField(args[2]);
    };
  }

  setExt(v: ExtView | null) {
    if (this.ext && this.ext !== v) this.ext.disable(this.game);
    if (v) this.set('none');
    this.ext = v;
    v?.enable(this.game);
    setProblemView(this.game.scene, v?.id ?? this.mode);
  }

  set(mode: ViewMode) {
    if (mode !== 'none' && this.ext) { this.ext.disable(this.game); this.ext = null; }
    if (this.mode === 'landValue' && mode !== 'landValue') this.resetBuildingColors();
    this.mode = mode;
    this.traffic.visible = mode === 'traffic';
    this.t = 0;
    setProblemView(this.game.scene, this.ext?.id ?? mode);
  }

  /** The renderer owns the palette. The HUD owns the user's setting. */
  setPalette(palette: OverlayPalette) {
    this.palette = palette;
    if (this.field) this.updateRamp();
  }

  /** Typed legend and actual data for the HUD's hover. */
  get legend(): OverlayLegend | null {
    const field = this.currentField();
    return field ? overlayLegend(field, this.palette) : null;
  }
  sample(x: number, z: number): number | null {
    const field = this.currentField();
    return field ? sampleOverlayField(field, x, z) : null;
  }

  private currentField(): ScalarField | null {
    const id = (this.ext?.id ?? this.mode).replace(/^svc:/, '');
    const view = FIELD_IDS.find(view => view === id);
    return view ? this.game.fields.fieldFor(view) : null;
  }

  private updateRamp() {
    const legend = overlayLegend(this.field!, this.palette);
    this.fieldUniforms.uFieldLow.value.set(legend.stops[0].color);
    this.fieldUniforms.uFieldMid.value.set(legend.stops[1].color);
    this.fieldUniforms.uFieldHigh.value.set(legend.stops[2].color);
  }

  private prepareField(camera: THREE.Camera) {
    const supplied = this.currentField();
    this.fieldUniforms.uFieldOn.value = supplied ? 1 : 0;
    if (!supplied) { this.field = null; return; }
    this.fieldUniforms.uFieldViewToWorld.value.copy(camera.matrixWorld);
    if (!this.field || this.field.view !== supplied.view || this.field.version !== supplied.version) {
      this.field = { ...supplied, data: supplied.data.slice(), legend: { ...supplied.legend } };
      const data = new Uint8Array(supplied.w * supplied.h * 4);
      const range = Math.max(Number.EPSILON, supplied.max - supplied.min);
      for (let i = 0; i < supplied.data.length; i++) {
        const value = supplied.data[i];
        if (!Number.isFinite(value)) continue;
        data[i * 4] = Math.round(Math.max(0, Math.min(1, (value - supplied.min) / range)) * 255);
        data[i * 4 + 3] = 255;
      }
      this.fieldTexture?.dispose();
      this.fieldTexture = new THREE.DataTexture(data, supplied.w, supplied.h, THREE.RGBAFormat);
      this.fieldTexture.minFilter = this.fieldTexture.magFilter = THREE.LinearFilter;
      this.fieldTexture.generateMipmaps = false;
      this.fieldTexture.needsUpdate = true;
      this.fieldUniforms.tField.value = this.fieldTexture;
      this.fieldUniforms.uFieldExtent.value.set(supplied.w * supplied.cellM, supplied.h * supplied.cellM);
      this.updateRamp();
    }
    // The field projection replaces the legacy terrain-only texture for fields
    // the simulation actually supplies. A null field keeps the old view path.
    INFO_OVERLAY.on.value = 0;
    this.game.scene.traverse(object => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const mat of Array.isArray(material) ? material : [material]) this.projectMaterial(mat);
    });
  }

  private projectMaterial(material: THREE.Material) {
    const mat = material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
    if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial &&
        !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial &&
        !(mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) return;
    if (this.patched.has(mat)) return;
    this.patched.add(mat);
    const previous = mat.onBeforeCompile, previousKey = mat.customProgramCacheKey();
    mat.onBeforeCompile = (shader, renderer) => {
      previous.call(mat, shader, renderer);
      Object.assign(shader.uniforms, this.fieldUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFieldWorld;\nuniform mat4 uFieldViewToWorld;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          // mvPosition already includes batching, instancing and billboard placement.
          vFieldWorld = (uFieldViewToWorld * mvPosition).xz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vFieldWorld;
          uniform sampler2D tField;
          uniform float uFieldOn;
          uniform vec2 uFieldExtent;
          uniform vec3 uFieldLow, uFieldMid, uFieldHigh;`)
        .replace('#include <opaque_fragment>', `
          if (uFieldOn > 0.5) {
            vec2 fieldUv = (vFieldWorld + ${HALF.toFixed(1)}) / uFieldExtent;
            vec4 fieldSample = texture2D(tField, fieldUv);
            float insideField = step(0.0, fieldUv.x) * step(fieldUv.x, 1.0) * step(0.0, fieldUv.y) * step(fieldUv.y, 1.0);
            float value = clamp(fieldSample.r / max(fieldSample.a, 0.0001), 0.0, 1.0);
            vec3 ramp = mix(mix(uFieldLow, uFieldMid, min(value * 2.0, 1.0)), uFieldHigh, max(value * 2.0 - 1.0, 0.0));
            float band = abs(fract(value * 5.0 + 0.5) - 0.5);
            float edge = max(fwidth(value * 5.0), 0.015);
            float contour = (1.0 - smoothstep(0.025, 0.025 + edge, band)) * step(0.001, value) * step(value, 0.999) * step(0.00001, fwidth(value));
            float light = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            vec3 base = vec3(light * 0.65 + 0.15);
            vec3 shadedRamp = ramp * clamp(light * 2.0 + 0.25, 0.4, 1.25);
            outgoingLight = mix(base, shadedRamp * mix(1.0, 0.65, contour), fieldSample.a * insideField * 0.78);
          }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => previousKey + '|scalar-field-v1';
    mat.needsUpdate = true;
  }

  /** Tint every building (null = no tint). For info views. */
  tintBuildings(colorFor: (b: import('../sim/buildings').Bld) => THREE.Color | null) {
    const B = this.game.buildings;
    for (const b of B.list.values()) B.setTint(b, colorFor(b));
  }

  resetBuildingColors() {
    const B = this.game.buildings;
    for (const b of B.list.values()) B.setTint(b, null);
  }

  update(dt: number) {
    if (this.ext) { this.ext.update?.(this.game, dt); return; }
    if (this.mode === 'none') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    if (this.mode === 'traffic') this.buildTraffic();
    else if (this.mode === 'landValue') {
      const c = new THREE.Color();
      for (const b of this.game.buildings.list.values()) {
        if (b.inst < 0) continue;
        const v = b.lv / 100;
        c.copy(C_BAD).lerp(C_MID, Math.min(1, v * 2)).lerp(C_GOOD, Math.max(0, v * 2 - 1));
        this.game.buildings.setTint(b, c);
      }
    }
  }

  private buildTraffic() {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    for (const s of this.game.net.segs.values()) {
      const vc = s.vc;
      c.copy(C_GOOD).lerp(C_MID, Math.min(1, vc / 0.5)).lerp(C_BAD, Math.max(0, Math.min(1, (vc - 0.5) / 0.5)));
      if (s.blocked > 0) c.set(0xff00aa);
      const hw = ROAD_TYPES[s.type].width / 2 + 0.3;
      const pts = s.samp.pts;
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        const rx = -tz / l, rz = tx / l;
        const y = s.hs[i] + 0.5;
        pos.push(pts[i].x - rx * hw, y, pts[i].z - rz * hw, pts[i].x + rx * hw, y, pts[i].z + rz * hw);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.traffic.geometry.dispose();
    this.traffic.geometry = g;
    void lerp;
  }
}
