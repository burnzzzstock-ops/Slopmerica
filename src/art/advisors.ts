// County Advisors: die-cut comic sticker portraits (256x256 WebP) matching the
// SLOP palette (#111111 ink, #efe6cf cream, #c6f432 lime, #b3202a Cannon red).
import chadImg from './advisors/chad.webp';
import daleImg from './advisors/dale.webp';
import debImg from './advisors/deb.webp';
import rickImg from './advisors/rick.webp';
import earlImg from './advisors/earl.webp';
import skylerImg from './advisors/skyler.webp';

export type AdvisorId = 'chad' | 'dale' | 'deb' | 'rick' | 'earl' | 'skyler';

export interface AdvisorDef {
  id: AdvisorId;
  name: string;
  role: string;
  handle: string;
  accent: string;
  portrait: string;
}

export const ADVISORS: Record<AdvisorId, AdvisorDef> = {
  chad: {
    id: 'chad',
    name: 'Chad Brokowski',
    role: 'Economic Development',
    handle: 'ShovelReadyChad',
    accent: '#c6f432',
    portrait: chadImg,
  },
  dale: {
    id: 'dale',
    name: 'Big Dale',
    role: 'Roads & Transportation',
    handle: 'OneMoreLaneDale',
    accent: '#c6f432',
    portrait: daleImg,
  },
  deb: {
    id: 'deb',
    name: 'Deb',
    role: 'HOA President',
    handle: 'DebForceOne',
    accent: '#b3202a',
    portrait: debImg,
  },
  rick: {
    id: 'rick',
    name: 'Pastor Rick',
    role: 'Megachurch & Easter Parking',
    handle: 'BlessedParkingRick',
    accent: '#f4b432',
    portrait: rickImg,
  },
  earl: {
    id: 'earl',
    name: 'Earl',
    role: 'Valley Old-Timer',
    handle: 'HollerEarl',
    accent: '#efe6cf',
    portrait: earlImg,
  },
  skyler: {
    id: 'skyler',
    name: 'Skyler',
    role: 'Urbanist on a Bike',
    handle: 'SafeStreetsSkyler',
    accent: '#5ec2f2',
    portrait: skylerImg,
  },
};

export function advisorById(id: AdvisorId): AdvisorDef {
  return ADVISORS[id];
}

export function advisorPortraitHTML(id: AdvisorId, size = 48): string {
  const a = ADVISORS[id];
  const px = Math.max(16, Math.min(256, size));
  return `<img class="advisor-sticker" src="${a.portrait}" alt="${a.name}" width="${px}" height="${px}" decoding="async" style="border-radius:50%;object-fit:cover;display:inline-block;vertical-align:middle" />`;
}
