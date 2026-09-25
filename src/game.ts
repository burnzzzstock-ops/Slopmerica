// Game: owns the scene and all subsystems, runs the frame loop.
import * as THREE from 'three';
import { defaultQuality, HALF, Quality } from './config';
import { generateMap, MapData, MapId } from './world/maps';
import { Terrain } from './world/terrain';
import { Trees } from './world/trees';
import { createWater } from './world/water';
import { Environment } from './world/sky';
import { PointerHandlers, RTSCamera } from './render/camera';

export type GameMode = 'sandbox' | 'ponzi' | 'hippie' | 'speedrun';

export interface GameOptions {
  map: MapId;
  mode: GameMode;
  quality?: Quality;
}

export class Game {
  readonly q: Quality;
  readonly map: MapData;
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly rts: RTSCamera;
  readonly terrain: Terrain;
  readonly trees: Trees;
  readonly env: Environment;
  readonly water: ReturnType<typeof createWater>;
  readonly timer = new THREE.Timer();
  time = 0;
  private handlers: PointerHandlers;
  private raf = 0;
  onFrame: ((dt: number) => void)[] = [];

  constructor(public container: HTMLElement, public opts: GameOptions) {
    this.q = opts.quality ?? defaultQuality();
    this.map = generateMap(opts.map);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 16000);

    this.terrain = new Terrain(this.map);
    this.scene.add(this.terrain.group);
    this.water = createWater(this.terrain, this.map.def.water);
    this.scene.add(this.water.mesh);
    this.trees = new Trees(this.terrain, this.map, this.q.treeDensity);
    this.scene.add(this.trees.group);
    this.env = new Environment(this.scene, this.map.def, this.q);

    this.handlers = {
      toolCapturesDrag: () => false,
      down: () => {},
      move: () => {},
      up: () => {},
      cancel: () => {},
    };
    this.rts = new RTSCamera(this.camera, this.renderer.domElement, this.terrain, {
      toolCapturesDrag: () => this.handlers.toolCapturesDrag(),
      down: (p, e) => this.handlers.down(p, e),
      move: (p, e, d) => this.handlers.move(p, e, d),
      up: (p, e, d) => this.handlers.up(p, e, d),
      cancel: () => this.handlers.cancel(),
    });
    const start = this.startView();
    this.rts.setView(start.x, start.z, 820, start.yaw, 0.72, true);

    window.addEventListener('resize', () => this.resize());
  }

  setHandlers(h: PointerHandlers) {
    this.handlers = h;
  }

  private startView() {
    const id = this.map.def.id;
    if (id === 'norcal') return { x: -380, z: 120, yaw: -1.9 };
    if (id === 'florida') return { x: 0, z: 200, yaw: 3.0 };
    return { x: -120, z: 60, yaw: 0.7 };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(0.1, this.timer.getDelta());
      this.frame(dt);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  frame(dt: number) {
    this.time += dt;
    this.rts.update(dt);
    this.env.update(dt * 0, this.rts.target, this.rts.distance);
    for (const f of this.onFrame) f(dt);
    this.terrain.flush();
    this.trees.wind.value = this.time;
    const wu = this.water.mat.uniforms;
    wu.uTime.value = this.time;
    wu.uSunDir.value.copy(this.env.sunDirection);
    wu.uNight.value = this.env.night;
    wu.uSky.value.copy(this.env.fog.color);
    this.renderer.render(this.scene, this.camera);
  }
}

export { HALF };
