// Street names: part real-estate euphemism (named after whatever got bulldozed),
// part internet brainrot.
import { fx } from '../core/rng';
import type { V2 } from '../core/math';
import type { Terrain } from '../world/terrain';
import type { RoadTypeId } from './roadTypes';

const NATURE_WATER = ['Creekside', 'Riverbend', 'Heron', 'Bayou', 'Willow Creek', 'Trout Run', 'Lagoon', 'Mill Creek', 'Stillwater', 'Crystal Springs'];
const NATURE_FOREST = ['Whispering Pines', 'Old Oak', 'Hemlock', 'Deer Run', 'Timberline', 'Hickory Hollow', 'Sequoia', 'Maple Ridge', 'Fox Den', 'Owl Hollow'];
const NATURE_OPEN = ['Meadowlark', 'Prairie Wind', 'Wildflower', 'Golden Hills', 'Sawgrass', 'Sunset', 'Cattail', 'Quail Run', 'Bluebonnet'];
const MEME = [
  "Let's Go Brandon", 'Sigma Grindset', 'Skibidi', 'Based', 'Ratio', 'Touch Grass', 'No Step On Snek', 'Woke', 'Soy',
  'Trust The Science', 'Just One More Lane', 'Rizzler', 'Gyatt', 'Ohio', 'Florida Man', 'Doge', 'HODL', 'Stonks',
  'Main Character', 'NPC', 'Chungus', 'Brainrot', 'Grok Is This True', 'Community Notes', 'Seed Oil', 'Raw Milk',
  'Tung Tung Sahur', 'Bombardiro', 'Slop', 'Slop Cannon', 'Wigette', 'Cannon Boys', 'Pig Cabana', 'Fill Er Up',
];
const SUFFIX: Record<RoadTypeId, string[]> = {
  gravel: ['Holler Rd', 'Hollow Rd', 'Lane', 'Trail', 'Pike'],
  twoLane: ['Dr', 'Ln', 'Ct', 'Way', 'Rd', 'Circle', 'Trace'],
  stroad4: ['Pkwy', 'Blvd', 'Hwy', 'Crossing', 'Commons Dr'],
  stroad6: ['Pkwy', 'Blvd', 'Freedom Hwy', 'Expressway'],
  stroad8: ['Mega Pkwy', 'Freedom Blvd', 'Hwy'],
  highway: ['Slopway', 'Interstate', 'Tollway', 'Beltway'],
};

export function roadName(type: RoadTypeId, terrain: Terrain, p: V2, _map?: { id: string }): string {
  if (type === 'highway') return fx.pick(['I-69 Slopway', 'I-420 Freedom Tollway', 'I-666 Beltway', 'US-1776 Expressway', 'Loop 69']);
  const h = terrain.h(p.x, p.z);
  const cover = terrain.coverAt(p.x, p.z);
  let base: string;
  const r = fx.float();
  if (r < 0.34) base = fx.pick(MEME);
  else if (h < 5) base = fx.pick(NATURE_WATER);
  else if (cover > 0.45) base = fx.pick(NATURE_FOREST);
  else base = fx.pick(NATURE_OPEN);
  return `${base} ${fx.pick(SUFFIX[type])}`;
}
