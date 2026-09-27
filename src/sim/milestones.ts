// Milestones, as in Cities: Skylines: the town earns its tools by growing.
// A new county starts with roads, small zones and the utilities, and every
// tier after that (at a real population, up to 10,000) unlocks the next batch
// of services, zones, roads and landmarks, with a state grant to help build
// them. Playtest: "you can build everything you need right away and then it
// just works"; in Skylines "they really space out when you unlock the city
// services, and you have to get some real population numbers to get there".
// Unlocks are earned once and kept, even if the city shrinks (the peak counts).
import type { LandmarkId, ZoneType } from '../contracts';
import type { RoadTypeId } from '../roads/roadTypes';

export interface Milestone {
  /** population that reaches it */
  pop: number;
  name: string;
  /** one line of flavour for the popup */
  blurb: string;
  /** state grant paid when it's reached */
  reward: number;
  zones?: ZoneType[];
  roads?: RoadTypeId[];
  /** city service ids (src/sim/services.ts) */
  services?: string[];
  /** roadside attraction size tiers (0 small, 1 medium, 2 large) */
  attractions?: number[];
  landmarks?: LandmarkId[];
  /** bus depots and lines */
  transit?: boolean;
  /** prebuilt road layouts (src/roads/interchanges.ts) */
  layouts?: string[];
}

export const MILESTONES: Milestone[] = [
  {
    pop: 0, name: 'Unincorporated Land', reward: 0,
    blurb: 'A county road, a gas station rumour and a dream.',
    zones: ['resLow', 'comLow', 'industry'], roads: ['gravel', 'twoLane', 'oneWay1'],
    services: ['gasPeaker', 'wellTower', 'waterPump', 'sewageOutfall', 'park'], landmarks: ['waterTower'], layouts: ['roundabout'],
  },
  {
    pop: 150, name: 'Wide Spot in the Road', reward: 5000,
    blurb: 'Enough people to generate trash and complaints.',
    roads: ['stroad4', 'oneWay2'], services: ['landfill', 'clinic'],
  },
  {
    pop: 350, name: 'Census-Designated Place', reward: 10000,
    blurb: 'The federal government has noticed you. Somewhat.',
    services: ['fireStation', 'sheriff'], attractions: [0], landmarks: ['propaneParadise'],
  },
  {
    pop: 650, name: 'Speed Trap Town', reward: 15000,
    blurb: 'A sheriff with a radar gun and a dream of his own.',
    zones: ['comHigh'], services: ['school', 'coalPlant'], transit: true, landmarks: ['fillErUpMegaStation'],
  },
  {
    pop: 1100, name: 'Boomburb', reward: 20000,
    blurb: 'Luxury apartments. The luxury is the word "luxury".',
    zones: ['resHigh'], roads: ['stroad6'], services: ['solarFarm'], attractions: [1], landmarks: ['slopCannon'],
  },
  {
    pop: 1800, name: 'Exurb', reward: 30000,
    blurb: 'Close enough to the city to complain about it.',
    zones: ['office'], services: ['treatmentPlant', 'incinerator'], landmarks: ['megachurch'],
  },
  {
    pop: 2800, name: 'Edge City', reward: 45000,
    blurb: 'An interstate exit, a hospital and three identical steakhouses.',
    roads: ['highway'], layouts: ['diamond'], services: ['hospital'], attractions: [2], landmarks: ['pigCabanaResort'],
  },
  {
    pop: 4200, name: 'Metroplex', reward: 60000,
    blurb: 'A university, an 8-lane stroad and a minor-league team.',
    roads: ['stroad8'], services: ['college'], landmarks: ['slop69Field'],
  },
  {
    pop: 6500, name: 'Megalopolis', reward: 90000,
    blurb: 'Nuclear power and an AI that drinks the reservoir.',
    services: ['nuclearPlant'], landmarks: ['neuralFlyDatacenter'],
  },
  {
    pop: 10000, name: 'Capital of Slop', reward: 150000,
    blurb: 'Everything is unlocked. Everything is a parking lot.',
  },
];

/** the highest milestone a population has reached (its index) */
export function tierAt(pop: number): number {
  let t = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (pop >= MILESTONES[i].pop) t = i;
  return t;
}

/** the population that unlocks something, or 0 when nothing gates it */
function popWhere(pred: (m: Milestone) => boolean | undefined): number {
  return MILESTONES.find((m) => pred(m))?.pop ?? 0;
}
export const unlockPop = {
  zone: (z: ZoneType) => popWhere((m) => m.zones?.includes(z)),
  road: (r: RoadTypeId) => popWhere((m) => m.roads?.includes(r)),
  service: (id: string) => popWhere((m) => m.services?.includes(id)),
  attraction: (tier: number) => popWhere((m) => m.attractions?.includes(tier)),
  landmark: (id: LandmarkId) => popWhere((m) => m.landmarks?.includes(id)),
  layout: (id: string) => popWhere((m) => m.layouts?.includes(id)),
  transit: () => popWhere((m) => m.transit),
};

// what each unlock is called ("🗑️ Mt. Trashmore Landfill"): each module names
// its own (roads, services, landmarks, zones), so this table stays a leaf
const NAMES = new Map<string, string>([['transit', '🚌 Buses'], ['att:0', '🗿 Small roadside attractions'], ['att:1', '🗿 Bigger roadside attractions'], ['att:2', '🗿 The biggest roadside attractions']]);
export function nameUnlock(key: string, name: string) { NAMES.set(key, name); }
/** everything a milestone unlocks, by name */
export function unlockNames(m: Milestone): string[] {
  const n = (k: string, fallback: string) => NAMES.get(k) ?? fallback;
  return [
    ...(m.zones ?? []).map((z) => n(`zone:${z}`, z)),
    ...(m.services ?? []).map((id) => n(`svc:${id}`, id)),
    ...(m.roads ?? []).map((r) => n(`road:${r}`, r)),
    ...(m.layouts ?? []).map((l) => n(`layout:${l}`, l)),
    ...(m.transit ? [n('transit', 'Buses')] : []),
    ...(m.attractions ?? []).map((t) => n(`att:${t}`, 'Roadside attractions')),
    ...(m.landmarks ?? []).map((id) => n(`lm:${id}`, id)),
  ];
}

/** the milestone that unlocks at a population (for "🔒 Speed Trap Town (650)") */
export function milestoneAt(pop: number): Milestone | undefined {
  return MILESTONES.find((m) => m.pop === pop);
}

/** "🔒 Speed Trap Town · 650" for a locked card */
export function lockText(pop: number): string {
  const m = milestoneAt(pop);
  return `🔒 ${m ? `${m.name} · ` : 'Pop '}${pop.toLocaleString()}`;
}
