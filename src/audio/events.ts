import type { Game } from '../game';
import { Sim } from '../sim/sim';

const bound = new WeakSet<Game>();

/** Read-only consumers of the simulation's event contract. Safe to install once or retry. */
export function bindWorldAudio(game: Game) {
  if (bound.has(game)) return;
  bound.add(game);
  const events = game.sim.events, audio = game.audio;
  events.on('construction', event => {
    if (event.progress !== 1) return;
    const building = game.buildings.list.get(event.bldId);
    if (building) audio.playAt('build', building.x, building.z, 0.3);
  });
  events.on('demolished', event => audio.playAt('bulldoze', event.x, event.z, 0.55));
  events.on('levelUp', event => {
    const building = game.buildings.list.get(event.bldId);
    if (building) audio.playAt('levelUp', building.x, building.z, 0.3);
  });
  events.on('crash', event => audio.playAt('crash', event.x, event.z, 0.3 + event.severity * 0.5));
  events.on('zonePainted', event => audio.zonePaint(event.x, event.z, event.cells));
  events.on('moneyTick', event => {
    if (event.delta <= 0) return;
    if (event.x !== undefined && event.z !== undefined) audio.playAt('cash', event.x, event.z, 0.2);
    else audio.play('cash', 0.2);
  });
  events.on('week', ledger => audio.play(Sim.split(ledger).total >= 0 ? 'cash' : 'error', 0.3));
  events.on('roadBuilt', event => {
    const segment = game.net.segs.get(event.segIds[0]);
    const point = segment?.samp.pts[Math.floor(segment.samp.pts.length / 2)];
    if (point) audio.playAt('build', point.x, point.z, 0.6);
  });
  events.on('laneAdded', event => {
    const segment = game.net.segs.get(event.segId);
    const point = segment?.samp.pts[Math.floor(segment.samp.pts.length / 2)];
    if (point) audio.playAt('build', point.x, point.z, 0.6);
  });
  events.on('treesCleared', event => { if (event.count > 0) audio.playAt('bulldoze', event.x, event.z, 0.18); });
  events.on('paradisePaved', () => { audio.duck(2.5); audio.play('notify', 0.65); });
  events.on('collapseStage', event => audio.play(event.stage < 5 ? 'error' : 'notify', 0.3));
}
