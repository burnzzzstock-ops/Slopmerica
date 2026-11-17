import type { Game } from '../game';
import { landmarkEvent } from '../agents/parking';

export type WorldSoundKind = 'intercom' | 'stadium' | 'church';
export interface WorldSoundSource { id: number; kind: WorldSoundKind; x: number; y: number; z: number; active: boolean; distance2: number }

/** Read-only source sampling. Reuses four records; never builds a drive-thru lane. */
export class WorldSoundSources {
  private elapsed = 1;
  readonly sources: WorldSoundSource[] = Array.from({ length: 4 }, () => ({ id: -1, kind: 'intercom', x: 0, y: 0, z: 0, active: false, distance2: Infinity }));

  sample(game: Game, dt = 1) {
    this.elapsed += dt;
    if (this.elapsed < 0.25) return this.sources;
    this.elapsed = 0;
    for (const source of this.sources) { source.active = false; source.distance2 = Infinity; }
    if (game.rts.distance >= 900) return this.sources;
    const target = game.rts.target;
    for (const car of game.traffic.cars) {
      const lane = car.thru?.L, building = lane?.b;
      if (!lane || !building || !game.traffic.renderer.isCarDrawn(car.id) || car.crashed !== 0 || car.thru!.out >= 0 || !lane.q.includes(car)) continue;
      if (building.state !== 'active' || building.offNet || building.inst < 0) continue;
      const point = lane.slots[0];
      if (point) this.offer(building.id, 'intercom', point.x, building.y + 1.6, point.z, target.x, target.z);
    }
    // Day zero is Friday, March 20, 2026. Attendance keeps its existing daily
    // schedule; church audio additionally respects the actual calendar Sunday.
    const sunday = ((Math.floor(game.sim.day) % 7) + 7) % 7 === 2;
    for (const building of game.buildings.list.values()) {
      if (building.state !== 'active' || building.offNet || building.inst < 0 || !landmarkEvent(building, game.hour)) continue;
      const kind = building.landmark === 'slop69Field' ? 'stadium' : building.landmark === 'megachurch' && sunday ? 'church' : null;
      if (kind) this.offer(building.id, kind, building.x, building.y + 4, building.z, target.x, target.z);
    }
    return this.sources;
  }

  private offer(id: number, kind: WorldSoundKind, x: number, y: number, z: number, tx: number, tz: number) {
    const distance2 = (x - tx) ** 2 + (z - tz) ** 2;
    if (distance2 > 90000) return;
    for (const source of this.sources) {
      if (source.active && source.id === id && source.kind === kind) return;
    }
    let at = 0;
    while (at < this.sources.length && this.sources[at].distance2 <= distance2) at++;
    if (at === this.sources.length) return;
    const entry = this.sources[this.sources.length - 1];
    for (let i = this.sources.length - 1; i > at; i--) this.sources[i] = this.sources[i - 1];
    this.sources[at] = entry;
    entry.id = id; entry.kind = kind; entry.x = x; entry.y = y; entry.z = z;
    entry.distance2 = distance2; entry.active = true;
  }
}
