// Extension points. Gameplay systems that live outside the core files (transit,
// freight, districts, terraforming, ...) register themselves here instead of
// editing game.ts / hud.ts / tools.ts. Everything is optional.
import type * as THREE from 'three';
import type { Game, Selection } from '../game';
import type { Json, Refs } from '../core/snapshot';

export interface ToolTipLike {
  text: string;
  bad?: boolean;
  /** a success to confirm (drawn green) */
  good?: boolean;
}

/** A pointer tool. Activate with `game.tools.setExt(id)`. */
export interface ExtTool {
  id: string;
  /** true if drags paint/draw instead of panning the camera */
  capturesDrag?: boolean;
  /** touch: lift the cursor above the finger (px) */
  touchLift?: number;
  down?(g: Game, p: THREE.Vector3, e: PointerEvent): void;
  move?(g: Game, p: THREE.Vector3 | null, e: PointerEvent, dragging: boolean): void;
  up?(g: Game, p: THREE.Vector3 | null, e: PointerEvent, wasDrag: boolean): void;
  /** Esc / right-click / tool switch */
  cancel?(g: Game): void;
  /** hover tip shown next to the cursor (desktop) or in the action bar (touch) */
  tip?(g: Game): ToolTipLike | null;
  /** touch: a placement planned by a tap, waiting for the action-bar Build button (cost null = can't build there) */
  pending?(g: Game): { cost: number | null } | null;
  /** touch: build the planned placement (the Build button) */
  confirm?(g: Game): void;
  /** the action-bar Done button, just before the tool is put away (finish drafts here) */
  done?(g: Game): void;
  /** the one thing this tool places, for the "Placing …" badge (null when it isn't a placement tool) */
  placing?(g: Game): string | null;
  /** an unfinished draft (a bus line's stops): right-click cancels it before putting the tool away */
  busy?(g: Game): boolean;
}

/** A toolbar button with a sub-panel. */
export interface ExtPanel {
  id: string;
  icon: string;
  label: string;
  /** toolbar position hint: lower first (core buttons are 10..110 in steps of 10) */
  order?: number;
  render(el: HTMLElement, g: Game, rerender: () => void): void;
  /** called when the panel closes */
  close?(g: Game): void;
  /** called twice a second while open, to update live numbers without a re-render */
  refresh?(el: HTMLElement, g: Game): void;
  /** show one part of the panel (a category) the next time it renders */
  focus?(g: Game, key: string): void;
}

/** An info view (overlay) listed in the Info Views panel. */
export interface ExtView {
  id: string;
  icon: string;
  label: string;
  enable(g: Game): void;
  disable(g: Game): void;
  /** per frame while enabled */
  update?(g: Game, dt: number): void;
  /** optional HTML legend shown under the view chips */
  legend?(g: Game): string;
}

/** Extra HTML rows for the inspector. Return null to add nothing. */
export type ExtInspector = (sel: NonNullable<Selection>, g: Game) => string | null;

/** A simulation system with lifecycle hooks and save data. */
export interface ExtSystem {
  id: string;
  init?(g: Game): void;
  /**
   * every rendered frame; simDays = game days advanced this frame. For what is drawn and heard only: anything that changes
   * the county belongs in step (or daily / weekly), or the same county comes out different at another frame rate.
   */
  frame?(g: Game, dt: number, simDays: number): void;
  /** every fixed step of the simulation: `dt` game seconds on */
  step?(g: Game, dt: number): void;
  daily?(g: Game, day: number): void;
  weekly?(g: Game): void;
  /** the county's dice were started again from g.seed: do the same with this system's own stream (streamSeed(g.seed, name)) */
  reseed?(g: Game): void;
  /** JSON-serializable state for saves */
  save?(g: Game): unknown;
  /**
   * Everything save() rounds off or leaves out, exactly (src/core/snapshot.ts: encode, with `refs` naming buildings, roads and
   * cars). With it a reload carries on as the same county; without it the system starts afresh from what save() kept.
   * loadExact runs after load() and after the cars are back.
   */
  saveExact?(g: Game, refs: Refs): Json;
  loadExact?(g: Game, data: Json, refs: Refs): void;
  /** restore before roads and buildings are rebuilt (e.g. terrain edits they sit on) */
  preload?(g: Game, data: unknown): void;
  load?(g: Game, data: unknown): void;
}

export const EXT = {
  panels: [] as ExtPanel[],
  tools: new Map<string, ExtTool>(),
  views: [] as ExtView[],
  inspector: [] as ExtInspector[],
  systems: [] as ExtSystem[],
};

export const registerPanel = (p: ExtPanel) => { EXT.panels.push(p); EXT.panels.sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); };
export const registerTool = (t: ExtTool) => { EXT.tools.set(t.id, t); };
export const registerView = (v: ExtView) => { EXT.views.push(v); };
export const registerInspector = (f: ExtInspector) => { EXT.inspector.push(f); };
export const registerSystem = (s: ExtSystem) => { EXT.systems.push(s); };
