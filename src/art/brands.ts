// Brand registry: the real SLOP / Imagine Supply Co. lines (used straight) and the
// parody chains. Adding a chain is one entry here; its signs are painted in code.
import type { ZoneType } from '../contracts';

export const MERCH_URL = 'https://imaginesupply.co/';
export const MERCH_DOMAIN = 'imaginesupply.co';

export type BrandKind =
  | 'gas' | 'food' | 'apparel' | 'bar' | 'smoke' | 'propane' | 'resort' | 'tech' | 'retail'
  | 'drink' | 'bank' | 'auto' | 'church' | 'industry' | 'office' | 'grocery' | 'storage' | 'fitness' | 'coffee';

/** The sign fonts index.html loads. */
export type SignFont = 'Bungee' | 'Anton' | 'Titan One' | 'Permanent Marker' | 'Yellowtail' | 'Overpass';

/** Building archetypes a brand can occupy (the generators pick the geometry). */
export type Archetype =
  // comLow
  | 'gas' | 'fastFood' | 'shop' | 'strip' | 'diner' | 'bar' | 'coffee' | 'carLot' | 'restaurant'
  // comHigh
  | 'bigBox' | 'mall' | 'flagship' | 'hotel' | 'neonTower'
  // industry
  | 'shed' | 'warehouse' | 'factory' | 'propaneDepot' | 'datacenter' | 'brewery'
  // office
  | 'contentFarm' | 'glassOffice' | 'campus' | 'officeTower';

export type SignStyle =
  | 'box' // lightbox panel, whole face glows
  | 'channel' // letters on a raceway, letters glow
  | 'pill'
  | 'oval'
  | 'tiles' // one letter per square tile (Waffle Hut)
  | 'script'
  | 'stripes'
  | 'slopScript'
  | 'slopLightning'
  | 'cannon'
  | 'neon';

export interface SignSpec {
  style: SignStyle;
  text?: string; // display text if different from the name
  sub?: string; // small second line
  font?: string; // font family
  icon?: string; // icon id from icons.ts
  bg?: string;
  fg?: string;
  accent?: string;
}

export interface Brand {
  id: string;
  name: string;
  kind: BrandKind;
  zones: ZoneType[]; // where it can spawn
  colors: [string, string]; // primary, secondary
  merch?: boolean; // real Imagine Supply Co. / Slop product line
  blurb?: string;
  font?: SignFont; // headline font (defaults to sign.font)
  // ---- additive fields (City Look workstream)
  arch?: Archetype[];
  levels?: [number, number]; // inclusive level range
  weight?: number; // spawn weight (default 1)
  sign?: SignSpec;
  tagline?: string;
}

const LO: ZoneType[] = ['comLow'];
const HI: ZoneType[] = ['comHigh'];
const BOTH: ZoneType[] = ['comLow', 'comHigh'];
const IND: ZoneType[] = ['industry'];
const OFF: ZoneType[] = ['office'];

export const BRANDS: Brand[] = [
  // ================================================================ SLOP / Imagine Supply Co. (real, owned)
  { id: 'slop', name: 'Slop', kind: 'apparel', zones: BOTH, colors: ['#111111', '#efe6cf'], merch: true, blurb: 'Slop Script. The official fit of Slopmerica.', arch: ['shop', 'strip', 'flagship'], weight: 2.5, tagline: 'THE OFFICIAL FIT OF SLOPMERICA', sign: { style: 'slopScript', bg: '#111111', fg: '#efe6cf' } },
  { id: 'slopLightning', name: 'SL⚡OP', kind: 'apparel', zones: BOTH, colors: ['#111111', '#f7d117'], merch: true, blurb: 'Slop Lightning Tee country.', arch: ['shop', 'strip', 'flagship'], weight: 1.2, tagline: 'SLOP LIGHTNING TEES', sign: { style: 'slopLightning', bg: '#111111', fg: '#f7d117' } },
  { id: 'slopCannon', name: 'Slop Cannon', kind: 'retail', zones: BOTH, colors: ['#111111', '#c6f432'], merch: true, blurb: 'Loose Cannon. Short Fuse. Play With Fire.', arch: ['shop', 'strip'], weight: 1.5, tagline: 'GET IN THE F*CKING CANNON', sign: { style: 'cannon', bg: '#111111', fg: '#c6f432', sub: 'FIREWORKS · APPAREL' } },
  { id: 'imagineSupply', name: 'Imagine Supply Co.', kind: 'apparel', zones: HI, colors: ['#efe6cf', '#111111'], merch: true, blurb: 'Flagship. imaginesupply.co', arch: ['flagship', 'mall'], levels: [2, 5], weight: 1.5, tagline: 'imaginesupply.co', sign: { style: 'box', font: 'Anton', bg: '#efe6cf', fg: '#111111', sub: 'IMAGINESUPPLY.CO', icon: 'cannon' } },
  { id: 'fillErUp', name: 'Fill Er Up', kind: 'gas', zones: LO, colors: ['#b3202a', '#1d3a8a'], merch: true, blurb: 'Gas, smokes and a whole lotta flag.', arch: ['gas'], weight: 3, tagline: 'GAS · SNACKS · FREEDOM', sign: { style: 'box', font: 'Bungee', bg: '#b3202a', fg: '#ffffff', accent: '#1d3a8a', icon: 'uncleSam', sub: 'GAS · SNACKS · FREEDOM' } },
  { id: 'myOwnPropane', name: 'My Own Propane', kind: 'propane', zones: ['comLow', 'industry'], colors: ['#1d4fa3', '#ffffff'], merch: true, blurb: 'Refills, exchanges, no questions.', arch: ['shop', 'propaneDepot'], weight: 1.5, tagline: 'REFILL · EXCHANGE · BBQ', sign: { style: 'box', font: 'Titan One', bg: '#1d4fa3', fg: '#ffffff', icon: 'propane', sub: 'REFILL · EXCHANGE' } },
  { id: 'propaneParadise', name: 'Propane Paradise', kind: 'propane', zones: ['comLow', 'industry'], colors: ['#12a39a', '#ff8a3d'], merch: true, blurb: 'Sun, sand and pressurized gas.', arch: ['shop', 'propaneDepot'], weight: 1, tagline: 'SUN · SAND · PRESSURIZED GAS', sign: { style: 'box', font: 'Titan One', bg: '#12a39a', fg: '#fff3d6', accent: '#ff8a3d', icon: 'palm', sub: 'SUN · SAND · PRESSURIZED GAS' } },
  { id: 'pigCabana', name: 'Pig Cabana', kind: 'resort', zones: BOTH, colors: ['#ff6f91', '#12a39a'], merch: true, blurb: 'Resort shirts, pulled pork, bad decisions.', arch: ['restaurant', 'bar', 'hotel'], weight: 1.5, tagline: 'RESORT WEAR · PULLED PORK', sign: { style: 'box', font: 'Titan One', bg: '#12a39a', fg: '#ffe7ef', accent: '#ff6f91', icon: 'pig', sub: 'BBQ · TIKI BAR · RESORT WEAR' } },
  { id: 'smokeshow', name: 'Smokeshow', kind: 'smoke', zones: LO, colors: ['#111111', '#ff3ea5'], merch: true, blurb: 'Smoke shop. Glass. CBD. Attitude.', arch: ['shop', 'strip'], weight: 2, tagline: 'SMOKE SHOP · GLASS · CBD', sign: { style: 'neon', font: 'Yellowtail', bg: '#141018', fg: '#ff3ea5', accent: '#34f5ff', sub: 'SMOKE SHOP · GLASS · CBD' } },
  { id: 'smokeSignal', name: 'Smoke Signal', kind: 'smoke', zones: LO, colors: ['#2b2b2b', '#ff8a3d'], merch: true, blurb: 'Vape, hookah and kratom by the pound.', arch: ['shop', 'strip'], weight: 2, tagline: 'VAPE · HOOKAH · KRATOM', sign: { style: 'box', font: 'Anton', bg: '#2b2b2b', fg: '#ff8a3d', icon: 'smoke', sub: 'VAPE · HOOKAH · KRATOM' } },
  { id: 'badLuckClub', name: 'Bad Luck Club', kind: 'bar', zones: BOTH, colors: ['#0b5d3b', '#111111'], merch: true, blurb: 'Pool, beer, regret.', arch: ['bar'], weight: 1.5, tagline: 'POOL · BEER · REGRET', sign: { style: 'box', font: 'Bungee', bg: '#0b5d3b', fg: '#f4efe2', icon: 'eightBalls', sub: 'POOL · BEER · REGRET' } },
  { id: 'cabinetAfterHours', name: 'Cabinet: After Hours', kind: 'bar', zones: BOTH, colors: ['#2a1250', '#c6f432'], merch: true, blurb: 'Cocktails until the cabinet meeting.', arch: ['bar'], weight: 1.2, tagline: 'COCKTAILS TIL 4AM', sign: { style: 'neon', font: 'Permanent Marker', text: 'Cabinet', bg: '#1a0b33', fg: '#b388ff', accent: '#c6f432', sub: 'AFTER HOURS · TIL 4AM' } },
  { id: 'neuralFly', name: 'Neural Fly', kind: 'tech', zones: ['industry', 'office'], colors: ['#0b0b14', '#ff2bd6'], merch: true, blurb: 'The AI that drinks the reservoir.', arch: ['datacenter', 'campus', 'officeTower'], levels: [3, 5], weight: 2, tagline: 'COMPUTE GOES BRRR', sign: { style: 'neon', font: 'Bungee', text: 'NEURAL FLY', bg: '#07070f', fg: '#34f5ff', accent: '#ff2bd6', icon: 'fly', sub: 'COMPUTE GOES BRRR' } },
  { id: 'slop69', name: 'Slop 69', kind: 'bar', zones: BOTH, colors: ['#f4efe2', '#1d3a8a'], merch: true, blurb: 'Sports bar. Pinstripes mandatory.', arch: ['bar', 'restaurant'], weight: 1.2, tagline: 'SPORTS BAR · WINGS · 69¢ DRAFTS', sign: { style: 'stripes', font: 'Yellowtail', text: 'Slop 69', bg: '#f4efe2', fg: '#1d3a8a', accent: '#b3202a', sub: 'SPORTS BAR · 69¢ DRAFTS' } },
  { id: 'slopEnergy', name: 'SLOP Energy', kind: 'drink', zones: ['industry', 'comLow'], colors: ['#111111', '#c6f432'], merch: true, blurb: 'Now with 900mg of caffeine.', arch: ['factory', 'shop'], weight: 1.5, tagline: 'NOW WITH 900MG CAFFEINE', sign: { style: 'box', font: 'Anton', text: 'SLOP ENERGY', bg: '#111111', fg: '#c6f432', icon: 'bolt', sub: 'NOW WITH 900MG CAFFEINE' } },
  { id: 'slopBeer', name: 'SLOP Beer', kind: 'drink', zones: ['industry', 'comLow'], colors: ['#c98b1a', '#111111'], merch: true, blurb: 'Brewed with local tap water. Flammable.', arch: ['brewery', 'bar'], weight: 1.5, tagline: 'BREWED WITH FLAMMABLE TAP WATER', sign: { style: 'oval', font: 'Yellowtail', text: 'Slop Beer', bg: '#c98b1a', fg: '#111111', accent: '#efe6cf', sub: 'LIGHT · HEAVY · REGRETTABLE' } },
  { id: 'cannonCoast', name: 'Cannon Coast', kind: 'apparel', zones: BOTH, colors: ['#12a39a', '#efe6cf'], merch: true, blurb: 'Beach button-ups with palms and a cannon.', arch: ['shop', 'hotel'], weight: 1, tagline: 'BEACH BUTTON-UPS', sign: { style: 'box', font: 'Yellowtail', bg: '#12a39a', fg: '#efe6cf', icon: 'palm', sub: 'SURF · SUN · ARTILLERY' } },
  { id: 'dirtyHabits', name: 'Dirty Habits', kind: 'bar', zones: BOTH, colors: ['#1a1a1a', '#c9a227'], merch: true, blurb: 'Martinis, dirty.', arch: ['bar'], weight: 1, tagline: 'MARTINI LOUNGE', sign: { style: 'neon', font: 'Yellowtail', bg: '#141414', fg: '#ffd166', accent: '#7ae582', icon: 'martini', sub: 'MARTINI LOUNGE' } },
  { id: 'hotPiece', name: 'Hot Piece', kind: 'food', zones: LO, colors: ['#ff9a6b', '#3b1f14'], merch: true, blurb: 'Pizza and peach cobbler. Get a hot piece.', arch: ['fastFood', 'restaurant'], weight: 1, tagline: 'PIZZA · PEACH COBBLER', sign: { style: 'box', font: 'Titan One', bg: '#3b1f14', fg: '#ff9a6b', icon: 'peach', sub: 'PIZZA · PEACH COBBLER' } },
  { id: 'sweetTrouble', name: 'Sweet Trouble', kind: 'food', zones: LO, colors: ['#e0233a', '#ffe0e6'], merch: true, blurb: 'Strawberry soft serve.', arch: ['fastFood', 'shop'], weight: 1, tagline: 'SOFT SERVE · SHAKES', sign: { style: 'box', font: 'Yellowtail', bg: '#ffe0e6', fg: '#e0233a', icon: 'strawberry', sub: 'SOFT SERVE · SHAKES' } },
  { id: 'cherryFuse', name: 'Cherry Fuse', kind: 'retail', zones: LO, colors: ['#c1121f', '#ffd400'], merch: true, blurb: 'Fireworks. Legally not a bomb store.', arch: ['shop'], weight: 1, tagline: 'FIREWORKS', sign: { style: 'box', font: 'Bungee', bg: '#ffd400', fg: '#c1121f', icon: 'cherryBomb', sub: 'FIREWORKS · BUY 1 GET 6' } },
  { id: 'badInfluence', name: 'Bad Influence', kind: 'smoke', zones: LO, colors: ['#111111', '#c6f432'], merch: true, blurb: 'Vape lounge.', arch: ['shop', 'strip'], weight: 1, tagline: 'VAPE LOUNGE', sign: { style: 'neon', font: 'Permanent Marker', bg: '#101010', fg: '#c6f432', accent: '#ff3ea5', icon: 'cloud', sub: 'VAPE LOUNGE' } },
  { id: 'socialClub', name: 'Social Club', kind: 'bar', zones: BOTH, colors: ['#1d3a8a', '#efe6cf'], merch: true, blurb: 'Members only (everyone is a member).', arch: ['bar'], weight: 0.8, tagline: 'MEMBERS ONLY*', sign: { style: 'script', font: 'Yellowtail', bg: '#1d3a8a', fg: '#efe6cf', sub: '*EVERYONE IS A MEMBER' } },
  { id: 'slopHQ', name: 'SLOP HQ', kind: 'office', zones: OFF, colors: ['#111111', '#efe6cf'], merch: true, blurb: 'World headquarters of Slop.', arch: ['officeTower'], levels: [4, 5], weight: 3, tagline: 'WORLD HEADQUARTERS', sign: { style: 'slopScript', bg: '#111111', fg: '#efe6cf' } },

  // ================================================================ gas
  { id: 'petroPatriot', name: 'Petro Patriot', kind: 'gas', zones: LO, colors: ['#1d3a8a', '#b3202a'], blurb: 'A gas station with a flag the size of a football field.', arch: ['gas'], weight: 2, tagline: 'PUMP LIKE AN AMERICAN', sign: { style: 'box', font: 'Bungee', bg: '#1d3a8a', fg: '#ffffff', accent: '#b3202a', icon: 'eagle', sub: 'PUMP LIKE AN AMERICAN' } },
  { id: 'possumPetes', name: "Possum Pete's Gas-N-Go", kind: 'gas', zones: LO, colors: ['#5a4632', '#ffcc33'], blurb: 'Fried chicken, live bait, fireworks, lottery.', arch: ['gas', 'shop'], weight: 2, tagline: 'LIVE BAIT · HOT CHICKEN · LOTTO', sign: { style: 'box', font: 'Titan One', text: "Possum Pete's", bg: '#ffcc33', fg: '#3b2a1a', icon: 'possum', sub: 'GAS-N-GO · LIVE BAIT · LOTTO' } },
  { id: 'dillos', name: "Dillo's", kind: 'gas', zones: BOTH, colors: ['#ffd100', '#c8102e'], blurb: '120 pumps. 80 toilets. Brisket.', arch: ['gas'], weight: 1.2, tagline: 'BRISKET · CLEAN TOILETS · 120 PUMPS', sign: { style: 'oval', font: 'Titan One', bg: '#ffd100', fg: '#c8102e', accent: '#111111', icon: 'armadillo', sub: 'BRISKET · 80 TOILETS' } },
  { id: 'kwikSketchy', name: 'Kwik-N-Sketchy', kind: 'gas', zones: LO, colors: ['#ff6b00', '#222222'], blurb: 'Cold beer, warm hot dogs.', arch: ['gas', 'shop'], weight: 1.2, tagline: 'COLD BEER · WARM HOT DOGS', sign: { style: 'box', font: 'Bungee', bg: '#222222', fg: '#ff6b00', sub: 'COLD BEER · WARM HOT DOGS' } },

  // ================================================================ food
  { id: 'chickFilEh', name: 'Chick-Fil-Eh', kind: 'food', zones: LO, colors: ['#d71920', '#ffffff'], blurb: 'Closed Sundays. Sorry, eh.', arch: ['fastFood'], weight: 2, tagline: 'CLOSED SUNDAYS. SORRY, EH.', sign: { style: 'script', font: 'Yellowtail', bg: '#ffffff', fg: '#d71920', icon: 'chicken', sub: 'SORRY, WE\'RE CLOSED. EH.' } },
  { id: 'waffleHut', name: 'Waffle Hut', kind: 'food', zones: LO, colors: ['#ffd400', '#111111'], blurb: 'Open 24/7/365. The disaster meter.', arch: ['diner'], weight: 2, tagline: 'NEVER CLOSED', sign: { style: 'tiles', text: 'WAFFLE HUT', bg: '#ffd400', fg: '#111111' } },
  { id: 'burgerBaron', name: 'Burger Baron', kind: 'food', zones: LO, colors: ['#ffb000', '#7a1f1f'], blurb: 'Have it his way.', arch: ['fastFood'], weight: 1.5, tagline: 'HAVE IT HIS WAY', sign: { style: 'oval', font: 'Titan One', bg: '#7a1f1f', fg: '#ffb000', icon: 'burger', sub: 'HAVE IT HIS WAY' } },
  { id: 'tacoBull', name: 'Taco Bull', kind: 'food', zones: LO, colors: ['#5b2a86', '#f2b134'], blurb: 'Run for the border (of the parking lot).', arch: ['fastFood'], weight: 1.5, tagline: 'THINK OUTSIDE THE BUN', sign: { style: 'box', font: 'Bungee', bg: '#5b2a86', fg: '#f2b134', icon: 'bull', sub: 'OPEN LATE · LATER · LATEST' } },
  { id: 'waddaBurger', name: 'Wadda-Burger', kind: 'food', zones: LO, colors: ['#ff6b00', '#ffffff'], blurb: 'Orange-striped A-frame of dreams.', arch: ['fastFood'], weight: 1.2, tagline: 'WADDA BURGER', sign: { style: 'stripes', font: 'Bungee', text: 'WADDA BURGER', bg: '#ffffff', fg: '#ff6b00', accent: '#ff6b00' } },
  { id: 'mcdougals', name: "McDougal's", kind: 'food', zones: LO, colors: ['#da291c', '#ffc72c'], blurb: 'Billions and billions served (in cars).', arch: ['fastFood'], weight: 1.5, tagline: 'BILLIONS SERVED (IN CARS)', sign: { style: 'box', font: 'Titan One', bg: '#da291c', fg: '#ffc72c', sub: 'BILLIONS SERVED (IN CARS)' } },
  { id: 'dairyMonarch', name: 'Dairy Monarch', kind: 'food', zones: LO, colors: ['#e31937', '#0072ce'], blurb: 'Blizzards of regret.', arch: ['fastFood'], weight: 1, tagline: 'SOFT SERVE · HARD TIMES', sign: { style: 'oval', font: 'Titan One', bg: '#e31937', fg: '#ffffff', accent: '#0072ce', icon: 'crown', sub: 'SOFT SERVE · HARD TIMES' } },
  { id: 'crackerBarn', name: 'Cracker Barn', kind: 'food', zones: LO, colors: ['#6b3a1f', '#f2c14e'], blurb: 'Rocking chairs, peg game, gravy.', arch: ['restaurant'], weight: 1, tagline: 'OLD COUNTRY STORE', sign: { style: 'box', font: 'Georgia', bg: '#6b3a1f', fg: '#f2c14e', sub: 'OLD COUNTRY STORE · GRAVY' } },
  { id: 'applebottoms', name: "Applebottom's", kind: 'food', zones: LO, colors: ['#8b0000', '#6fbf4a'], blurb: 'Neighborhood grill, 40 min from any neighborhood.', arch: ['restaurant'], weight: 1, tagline: 'NEIGHBORHOOD GRILL', sign: { style: 'script', font: 'Yellowtail', bg: '#8b0000', fg: '#ffffff', sub: 'NEIGHBORHOOD GRILL + BAR' } },
  { id: 'oliveYard', name: 'Olive Yard', kind: 'food', zones: LO, colors: ['#5a6b2a', '#f3e9d2'], blurb: "When you're here, you're parked.", arch: ['restaurant'], weight: 1, tagline: "WHEN YOU'RE HERE, YOU'RE PARKED", sign: { style: 'script', font: 'Yellowtail', bg: '#f3e9d2', fg: '#5a6b2a', sub: "WHEN YOU'RE HERE, YOU'RE PARKED" } },
  { id: 'goldenTrough', name: 'Golden Trough', kind: 'food', zones: LO, colors: ['#c9a227', '#4a1c1c'], blurb: 'All-you-can-eat buffet.', arch: ['restaurant'], weight: 1, tagline: 'ALL YOU CAN EAT · ALL DAY', sign: { style: 'box', font: 'Titan One', bg: '#4a1c1c', fg: '#ffd166', icon: 'pig', sub: 'BUFFET · ALL YOU CAN EAT' } },
  { id: 'krispyKrime', name: 'Krispy Krime', kind: 'food', zones: LO, colors: ['#006341', '#d6001c'], blurb: 'HOT NOW (always).', arch: ['coffee', 'fastFood'], weight: 1, tagline: 'HOT NOW (ALWAYS)', sign: { style: 'oval', font: 'Yellowtail', bg: '#ffffff', fg: '#006341', accent: '#d6001c', icon: 'donut', sub: 'HOT NOW (ALWAYS)' } },
  { id: 'hoots', name: 'Hoots', kind: 'food', zones: LO, colors: ['#ff6600', '#ffffff'], blurb: 'Wings. Beer. Nice views.', arch: ['restaurant', 'bar'], weight: 1, tagline: 'WINGS · BEER · NICE VIEWS', sign: { style: 'box', font: 'Titan One', bg: '#ff6600', fg: '#ffffff', icon: 'owl', sub: 'WINGS · BEER · NICE VIEWS' } },
  { id: 'wokeBrew', name: 'Woke Brew Coffee', kind: 'food', zones: LO, colors: ['#1b4332', '#d8f3dc'], blurb: 'Ethically sourced guilt. Oat milk +$2.', arch: ['coffee'], weight: 1.5, tagline: 'ETHICALLY SOURCED GUILT', sign: { style: 'box', font: 'Overpass', text: 'WOKE BREW', bg: '#1b4332', fg: '#d8f3dc', icon: 'coffeeEye', sub: 'ETHICALLY SOURCED GUILT' } },
  { id: 'soyLatte', name: 'Soy Latte Co.', kind: 'food', zones: LO, colors: ['#f1e3c8', '#6b8f3a'], blurb: 'Now with more oats.', arch: ['coffee'], weight: 1.2, tagline: 'OAT · ALMOND · SOY · VIBES', sign: { style: 'script', font: 'Yellowtail', bg: '#f1e3c8', fg: '#4a6b2a', icon: 'soy', sub: 'OAT · ALMOND · SOY · VIBES' } },
  { id: 'kombucha', name: 'Kombucha Kollective', kind: 'food', zones: LO, colors: ['#7b2cbf', '#ffd6ff'], blurb: 'Fermented opinions on tap.', arch: ['coffee', 'shop'], weight: 0.8, tagline: 'FERMENTED OPINIONS ON TAP', sign: { style: 'box', font: 'Permanent Marker', bg: '#ffd6ff', fg: '#7b2cbf', icon: 'soy', sub: 'FERMENTED OPINIONS ON TAP' } },

  // ================================================================ retail / strip-mall filler
  { id: 'dollarColonel', name: 'Dollar Colonel', kind: 'retail', zones: LO, colors: ['#ffd400', '#111111'], blurb: 'Self-seeding.', arch: ['shop', 'strip'], weight: 3, tagline: 'EVERYTHING $1.25 (ALMOST)', sign: { style: 'box', font: 'Anton', text: 'DOLLAR COLONEL', bg: '#ffd400', fg: '#111111', sub: 'EVERYTHING $1.25 (ALMOST)' } },
  { id: 'mattressKingdom', name: 'Mattress Kingdom', kind: 'retail', zones: BOTH, colors: ['#1c3f94', '#ffffff'], blurb: 'Always two, across the street from each other.', arch: ['shop', 'strip', 'bigBox'], weight: 1.5, tagline: 'THE OTHER ONE IS ACROSS THE STREET', sign: { style: 'box', font: 'Bungee', bg: '#1c3f94', fg: '#ffffff', icon: 'crown', sub: 'BLOWOUT SALE · EVERY DAY' } },
  { id: 'ezMoney', name: 'EZ Money Title Loans', kind: 'bank', zones: LO, colors: ['#2e7d32', '#ffd400'], blurb: 'Your truck = cash (until it isn\'t).', arch: ['shop', 'strip'], weight: 1.2, tagline: 'YOUR TRUCK = CASH', sign: { style: 'box', font: 'Anton', text: 'EZ MONEY', bg: '#2e7d32', fg: '#ffd400', icon: 'moneyBag', sub: 'TITLE LOANS · 389% APR' } },
  { id: 'pawnographer', name: 'Pawnographer', kind: 'retail', zones: LO, colors: ['#111111', '#ffcc00'], blurb: 'We buy gold, guns, guitars and grievances.', arch: ['shop', 'strip'], weight: 1.2, tagline: 'GOLD · GUNS · GUITARS', sign: { style: 'box', font: 'Bungee', bg: '#111111', fg: '#ffcc00', icon: 'dollar', sub: 'PAWN · GOLD · GUITARS' } },
  { id: 'ladyLiberty', name: 'Lady Liberty Tax', kind: 'bank', zones: LO, colors: ['#1d3a8a', '#4db6ac'], blurb: 'A guy in a Statue of Liberty costume spins a sign out front.', arch: ['strip', 'shop'], weight: 1, tagline: 'REFUNDS (NOT GUARANTEED)', sign: { style: 'box', font: 'Overpass', text: 'LADY LIBERTY TAX', bg: '#ffffff', fg: '#1d3a8a', icon: 'torch', sub: 'REFUNDS (NOT GUARANTEED)' } },
  { id: 'freedomFireworks', name: 'Freedom Fireworks', kind: 'retail', zones: LO, colors: ['#b3202a', '#1d3a8a'], blurb: 'Buy 1 get 6 free.', arch: ['shop'], weight: 1.2, tagline: 'BUY 1 GET 6 FREE', sign: { style: 'box', font: 'Bungee', bg: '#1d3a8a', fg: '#ffffff', accent: '#b3202a', icon: 'fireworks', sub: 'BUY 1 GET 6 FREE' } },
  { id: 'specter', name: 'Specter Halloween', kind: 'retail', zones: BOTH, colors: ['#111111', '#ff7518'], blurb: 'Coming soon to your dead storefront.', arch: ['strip', 'shop', 'bigBox'], weight: 0.8, tagline: 'NOW OPEN (TEMPORARILY)', sign: { style: 'box', font: 'Permanent Marker', bg: '#111111', fg: '#ff7518', icon: 'ghost', sub: 'NOW OPEN (TEMPORARILY)' } },
  { id: 'cicada', name: 'Cicada Wireless', kind: 'retail', zones: LO, colors: ['#6a1b9a', '#b2ff59'], blurb: '5G: buffering at five gigs.', arch: ['strip', 'shop'], weight: 1, tagline: 'NOW BUFFERING IN 5G', sign: { style: 'box', font: 'Overpass', text: 'CICADA WIRELESS', bg: '#6a1b9a', fg: '#ffffff', icon: 'cicada', sub: 'NOW BUFFERING IN 5G' } },
  { id: 'boozeBarn', name: 'Booze Barn', kind: 'retail', zones: LO, colors: ['#8b1e1e', '#f5e6c8'], blurb: 'Drive-thru liquor.', arch: ['shop', 'strip'], weight: 1.5, tagline: 'DRIVE-THRU LIQUOR', sign: { style: 'box', font: 'Anton', text: 'BOOZE BARN', bg: '#8b1e1e', fg: '#f5e6c8', icon: 'bottle', sub: 'LIQUOR · DRIVE-THRU' } },
  { id: 'kratomHut', name: 'Kratom Hut', kind: 'smoke', zones: LO, colors: ['#33691e', '#ffeb3b'], blurb: 'It\'s a plant, man.', arch: ['shop', 'strip'], weight: 1, tagline: "IT'S A PLANT, MAN", sign: { style: 'box', font: 'Titan One', bg: '#33691e', fg: '#ffeb3b', icon: 'soy', sub: "KRATOM · KAVA · IT'S A PLANT" } },
  { id: 'cloudChasers', name: 'Cloud Chasers Vape', kind: 'smoke', zones: LO, colors: ['#0d1b2a', '#4cc9f0'], blurb: 'Mango pod headquarters.', arch: ['shop', 'strip'], weight: 1.5, tagline: 'VAPE · CBD · MANGO', sign: { style: 'neon', font: 'Bungee', text: 'VAPE', bg: '#0d1b2a', fg: '#4cc9f0', accent: '#f72585', icon: 'cloud', sub: 'CLOUD CHASERS · CBD · MANGO' } },
  { id: 'regretInk', name: 'Regret Ink', kind: 'retail', zones: LO, colors: ['#111111', '#e63946'], blurb: 'Walk-ins welcome. Walk-outs too.', arch: ['strip'], weight: 1, tagline: 'TATTOO · PIERCING · WALK-INS', sign: { style: 'neon', font: 'Permanent Marker', bg: '#111111', fg: '#e63946', accent: '#f1faee', icon: 'skull', sub: 'TATTOO · WALK-INS' } },
  { id: 'nailedIt', name: 'Nailed It Nails', kind: 'retail', zones: LO, colors: ['#ff99c8', '#ffffff'], blurb: 'Nail salon. Always open, always a wait.', arch: ['strip'], weight: 1, tagline: 'NAILS · SPA · WALK-INS', sign: { style: 'script', font: 'Yellowtail', text: 'Nailed It', bg: '#ffffff', fg: '#e5383b', sub: 'NAILS · SPA · WALK-INS' } },
  { id: 'urgentish', name: 'Urgent-ish Care', kind: 'retail', zones: LO, colors: ['#ffffff', '#d62828'], blurb: 'Freestanding ER, 4-hour wait.', arch: ['strip', 'shop'], weight: 1, tagline: 'WAIT TIME: YES', sign: { style: 'box', font: 'Overpass', text: 'URGENT-ISH CARE', bg: '#ffffff', fg: '#d62828', icon: 'cross', sub: 'CURRENT WAIT: 4 HRS' } },
  { id: 'bailBondz', name: 'Bail Bondz 24/7', kind: 'bank', zones: LO, colors: ['#111111', '#ffd400'], blurb: 'Call us from jail.', arch: ['strip', 'shop'], weight: 0.8, tagline: 'CALL US FROM JAIL', sign: { style: 'box', font: 'Anton', text: 'BAIL BONDZ 24/7', bg: '#ffd400', fg: '#111111', sub: 'CALL US FROM JAIL' } },
  { id: 'daiquiriDepot', name: 'Daiquiri Depot', kind: 'bar', zones: LO, colors: ['#00b4d8', '#ff006e'], blurb: 'Drive-thru daiquiris (legally a to-go cup).', arch: ['coffee', 'bar'], weight: 1, tagline: 'DRIVE-THRU DAIQUIRIS', sign: { style: 'neon', font: 'Titan One', bg: '#03045e', fg: '#00b4d8', accent: '#ff006e', icon: 'martini', sub: 'DRIVE-THRU · LEGALLY' } },
  { id: 'uStoreIt', name: 'U-Store-It 4Ever', kind: 'storage', zones: ['comLow', 'industry'], colors: ['#ff6b00', '#ffffff'], blurb: 'Your stuff\'s stuff has stuff.', arch: ['shed', 'shop'], weight: 1, tagline: 'FIRST MONTH $1', sign: { style: 'box', font: 'Bungee', bg: '#ff6b00', fg: '#ffffff', icon: 'box', sub: 'SELF STORAGE · 1ST MONTH $1' } },
  { id: 'bitcorn', name: 'Bitcorn ATM', kind: 'bank', zones: LO, colors: ['#f5b300', '#111111'], blurb: 'Crypto ATM inside every vape shop.', arch: ['shop'], weight: 0.8, tagline: 'BUY BITCORN HERE', sign: { style: 'box', font: 'Bungee', text: 'BITCORN ATM', bg: '#111111', fg: '#f5b300', icon: 'coin', sub: 'BUY · SELL · CRY' } },
  { id: 'cyberslop', name: 'Cyberslop Showroom', kind: 'auto', zones: BOTH, colors: ['#9ea7ad', '#111111'], blurb: 'Bulletproof. Not rainproof.', arch: ['carLot', 'flagship'], weight: 1, tagline: 'BULLETPROOF (NOT RAINPROOF)', sign: { style: 'channel', font: 'Overpass', text: 'CYBERSLOP', bg: '#1b1b1b', fg: '#e0e4e8', sub: 'BULLETPROOF (NOT RAINPROOF)' } },
  { id: 'buyHerePayHere', name: 'Big Earl\'s Buy Here Pay Here', kind: 'auto', zones: LO, colors: ['#ffd400', '#d00000'], blurb: 'No credit, bad credit, crimes.', arch: ['carLot'], weight: 1.2, tagline: 'NO CREDIT? NO PROBLEM', sign: { style: 'box', font: 'Anton', text: "BIG EARL'S AUTO", bg: '#d00000', fg: '#ffd400', icon: 'car', sub: 'BUY HERE · PAY HERE · PRAY HERE' } },
  { id: 'coalRollin', name: "Coal Rollin' Diesel", kind: 'auto', zones: LO, colors: ['#111111', '#ff6b00'], blurb: 'Lift kits. Stacks. Trigger a Prius today.', arch: ['shop', 'carLot'], weight: 1, tagline: 'TRIGGER A PRIUS TODAY', sign: { style: 'box', font: 'Anton', text: "COAL ROLLIN' DIESEL", bg: '#111111', fg: '#ff6b00', icon: 'truck', sub: 'LIFT KITS · STACKS · TUNES' } },
  { id: 'tacticalTeds', name: "Tactical Ted's", kind: 'retail', zones: LO, colors: ['#4b5320', '#f4efe2'], blurb: 'Guns, ammo, tactical socks.', arch: ['shop', 'strip'], weight: 1, tagline: 'TACTICAL SOCKS IN STOCK', sign: { style: 'box', font: 'Bungee', bg: '#4b5320', fg: '#f4efe2', icon: 'shield', sub: 'AMMO · OPTICS · TACTICAL SOCKS' } },
  { id: 'crystalHealing', name: 'Crystal Healing & CBD', kind: 'retail', zones: LO, colors: ['#b5179e', '#f1e9ff'], blurb: 'Aligns your chakras and your credit score.', arch: ['strip', 'shop'], weight: 0.8, tagline: 'ALIGN YOUR CREDIT SCORE', sign: { style: 'script', font: 'Yellowtail', text: 'Crystal Healing', bg: '#f1e9ff', fg: '#7209b7', icon: 'sparkle', sub: 'CBD · SOUND BATHS · VIBES' } },
  { id: 'griftShop', name: 'Grift Shop', kind: 'retail', zones: LO, colors: ['#e9c46a', '#264653'], blurb: 'Thrift, but make it $80.', arch: ['strip', 'shop'], weight: 0.8, tagline: 'VINTAGE · CURATED · $80 TEES', sign: { style: 'box', font: 'Permanent Marker', bg: '#e9c46a', fg: '#264653', sub: 'THRIFT, BUT MAKE IT $80' } },
  { id: 'cancelCleaners', name: 'Cancel Culture Cleaners', kind: 'retail', zones: LO, colors: ['#90e0ef', '#023e8a'], blurb: 'We get out any stain. Even on your reputation.', arch: ['strip'], weight: 0.8, tagline: 'ANY STAIN. EVEN YOUR REPUTATION.', sign: { style: 'box', font: 'Overpass', text: 'CANCEL CULTURE CLEANERS', bg: '#ffffff', fg: '#023e8a', icon: 'wave', sub: 'DRY CLEANING · REPUTATION REPAIR' } },
  { id: 'planetFatness', name: 'Planet Fatness', kind: 'retail', zones: BOTH, colors: ['#7b2cbf', '#ffd400'], blurb: 'No judgment. No exercise. Free pizza Mondays.', arch: ['strip', 'bigBox'], weight: 1, tagline: 'FREE PIZZA MONDAYS', sign: { style: 'box', font: 'Titan One', bg: '#7b2cbf', fg: '#ffd400', sub: 'NO JUDGMENT · FREE PIZZA' } },

  // ================================================================ big boxes, malls, commercial towers
  { id: 'sprawlmart', name: 'SprawlMart', kind: 'retail', zones: HI, colors: ['#0071ce', '#ffc220'], blurb: '24/7. 1,200 parking spaces. Kills downtowns on contact.', arch: ['bigBox'], levels: [1, 3], weight: 3, tagline: 'SAVE MONEY. LIVE IN YOUR CAR.', sign: { style: 'channel', font: 'Overpass', text: 'SprawlMart', bg: '#0b3a6b', fg: '#ffffff', accent: '#ffc220', icon: 'sun', sub: 'SUPERCENTER · 24 HRS' } },
  { id: 'homeDespot', name: 'Home Despot', kind: 'retail', zones: HI, colors: ['#f96302', '#ffffff'], blurb: 'Let\'s do this (to your weekend).', arch: ['bigBox'], levels: [1, 3], weight: 2, tagline: "MORE SAVING. MORE DOING. LESS WEEKEND.", sign: { style: 'box', font: 'Anton', text: 'THE HOME DESPOT', bg: '#f96302', fg: '#ffffff', icon: 'hammer', sub: 'MORE DOING · LESS WEEKEND' } },
  { id: 'bullseye', name: 'Bullseye', kind: 'retail', zones: HI, colors: ['#cc0000', '#ffffff'], blurb: 'You came for toothpaste. You left with a patio set.', arch: ['bigBox', 'mall'], levels: [1, 4], weight: 2, tagline: 'CAME FOR TOOTHPASTE', sign: { style: 'channel', font: 'Overpass', text: 'BULLSEYE', bg: '#ffffff', fg: '#cc0000', icon: 'target' } },
  { id: 'bulkco', name: 'BulkCo', kind: 'grocery', zones: HI, colors: ['#e31837', '#005daa'], blurb: 'A 40-lb jar of mayo and a hot dog.', arch: ['bigBox'], levels: [1, 3], weight: 1.5, tagline: 'WHOLESALE · $1.50 HOT DOG', sign: { style: 'box', font: 'Anton', text: 'BULKCO', bg: '#e31837', fg: '#ffffff', accent: '#005daa', sub: 'W H O L E S A L E' } },
  { id: 'tractorSurplus', name: 'Tractor Surplus', kind: 'retail', zones: ['comHigh', 'comLow'], colors: ['#c8102e', '#ffffff'], blurb: 'For life out here (in the subdivision).', arch: ['bigBox', 'shop'], levels: [1, 3], weight: 1.2, tagline: 'FOR LIFE OUT HERE (THE SUBDIVISION)', sign: { style: 'box', font: 'Bungee', text: 'TRACTOR SURPLUS', bg: '#c8102e', fg: '#ffffff', icon: 'tractor', sub: 'FOR LIFE OUT HERE' } },
  { id: 'bassBros', name: 'Bass Bros. Outdoor Pyramid', kind: 'retail', zones: HI, colors: ['#2e4a1e', '#d4a017'], blurb: 'A glass pyramid full of taxidermy.', arch: ['flagship', 'bigBox'], levels: [2, 4], weight: 1, tagline: 'OUTDOOR PYRAMID', sign: { style: 'box', font: 'Bungee', text: 'BASS BROS.', bg: '#2e4a1e', fg: '#d4a017', icon: 'fish', sub: 'OUTDOOR PYRAMID' } },
  { id: 'wholePaycheck', name: 'Whole Paycheck', kind: 'grocery', zones: BOTH, colors: ['#00674b', '#f2e8cf'], blurb: 'Organic. Artisanal. $14 kale.', arch: ['bigBox', 'strip'], levels: [1, 4], weight: 1.2, tagline: '$14 KALE · ORGANIC FEELINGS', sign: { style: 'box', font: 'Georgia', text: 'Whole Paycheck', bg: '#00674b', fg: '#f2e8cf', icon: 'soy', sub: 'MARKET · $14 KALE' } },
  { id: 'sprawlGalleria', name: 'The Galleria at Sprawl Pointe', kind: 'retail', zones: HI, colors: ['#8d6e63', '#fff3e0'], blurb: 'A mall. 40% Specter Halloween.', arch: ['mall'], levels: [2, 4], weight: 2, tagline: 'NOW 60% OCCUPIED', sign: { style: 'script', font: 'Yellowtail', text: 'The Galleria', bg: '#4e342e', fg: '#fff3e0', sub: 'AT SPRAWL POINTE' } },
  { id: 'slopPlaza', name: 'Slop Plaza', kind: 'retail', zones: HI, colors: ['#111111', '#c6f432'], merch: true, blurb: 'Neon tower of Slop.', arch: ['neonTower', 'hotel'], levels: [4, 5], weight: 2, tagline: 'imaginesupply.co', sign: { style: 'slopScript', bg: '#111111', fg: '#efe6cf' } },
  { id: 'megaHotel', name: 'Grand Parkway Suites', kind: 'resort', zones: HI, colors: ['#1d3557', '#e9c46a'], blurb: 'Business hotel next to the freeway exit.', arch: ['hotel', 'neonTower'], levels: [3, 5], weight: 1.5, tagline: 'FREE WAFFLES · FREEWAY VIEWS', sign: { style: 'channel', font: 'Georgia', text: 'GRAND PARKWAY SUITES', bg: '#1d3557', fg: '#e9c46a', sub: 'FREEWAY VIEWS · FREE WAFFLES' } },
  { id: 'timesSlop', name: 'SlopTok Tower', kind: 'tech', zones: HI, colors: ['#000000', '#25f4ee'], blurb: 'The screens never stop.', arch: ['neonTower'], levels: [4, 5], weight: 1.5, tagline: 'FOR YOU PAGE', sign: { style: 'neon', font: 'Bungee', text: 'SLOPTOK', bg: '#000000', fg: '#25f4ee', accent: '#fe2c55', sub: 'FOR YOU PAGE' } },

  // ================================================================ industry
  { id: 'amazin', name: "Amazin' Fulfillment", kind: 'industry', zones: IND, colors: ['#232f3e', '#ff9900'], blurb: '20 years tax-free.', arch: ['warehouse'], weight: 3, tagline: 'WE DELIVER (YOUR TAX BASE)', sign: { style: 'box', font: 'Overpass', text: "amazin'", bg: '#232f3e', fg: '#ffffff', accent: '#ff9900', icon: 'box', sub: 'FULFILLMENT CENTER · 20 YRS TAX FREE' } },
  { id: 'cousinDale', name: "Cousin Dale's Paving LLC", kind: 'industry', zones: IND, colors: ['#ffd400', '#111111'], blurb: 'No-bid contracts since 1987.', arch: ['shed'], weight: 2, tagline: 'NO BID TOO LOW', sign: { style: 'box', font: 'Anton', text: "COUSIN DALE'S PAVING", bg: '#ffd400', fg: '#111111', sub: 'NO BID TOO LOW · EST. 1987' } },
  { id: 'frackDaddy', name: 'Frack Daddy Energy', kind: 'industry', zones: IND, colors: ['#3a3a3a', '#ff6b00'], blurb: 'Your faucet is a lighter now.', arch: ['factory', 'shed'], weight: 1.2, tagline: 'LIGHT YOUR FAUCET', sign: { style: 'box', font: 'Bungee', bg: '#3a3a3a', fg: '#ff6b00', icon: 'flame', sub: 'LIGHT YOUR FAUCET' } },
  { id: 'hashBrowns', name: 'HashBrowns Crypto Mining', kind: 'industry', zones: IND, colors: ['#1b1b1b', '#f5b300'], blurb: 'Humming at a pitch only dogs and Earl can hear.', arch: ['datacenter', 'warehouse'], levels: [2, 5], weight: 1, tagline: 'MINING SINCE THE LAST CRASH', sign: { style: 'box', font: 'Bungee', text: 'HASHBROWNS', bg: '#1b1b1b', fg: '#f5b300', icon: 'coin', sub: 'CRYPTO MINING · 24/7 HUM' } },
  { id: 'muskratGiga', name: 'Muskrat Gigafactory', kind: 'industry', zones: IND, colors: ['#e0e0e0', '#cc0000'], blurb: 'Elongated Muskrat promises it opens next year.', arch: ['factory', 'warehouse'], levels: [3, 5], weight: 1, tagline: 'FULL SELF-BUILDING NEXT YEAR', sign: { style: 'channel', font: 'Overpass', text: 'GIGAFACTORY', bg: '#f0f0f0', fg: '#1a1a1a', sub: 'OPENING NEXT YEAR (SINCE 2019)' } },
  { id: 'hogHeaven', name: 'Hog Heaven Pork Co.', kind: 'industry', zones: IND, colors: ['#f7a8b8', '#5a3a1a'], blurb: 'The lagoon is not for swimming.', arch: ['shed', 'factory'], weight: 1, tagline: 'THE LAGOON IS NOT FOR SWIMMING', sign: { style: 'box', font: 'Titan One', bg: '#5a3a1a', fg: '#f7a8b8', icon: 'pig', sub: 'PORK PROCESSING' } },
  { id: 'flatTop', name: 'Flat Top Mining Co.', kind: 'industry', zones: IND, colors: ['#3e2723', '#ffcc80'], blurb: 'Mountaintops removed while you wait.', arch: ['shed', 'factory'], weight: 1, tagline: 'MOUNTAINTOPS REMOVED WHILE-U-WAIT', sign: { style: 'box', font: 'Anton', text: 'FLAT TOP MINING CO.', bg: '#3e2723', fg: '#ffcc80', sub: 'SHOVEL-READY SINCE 1971' } },
  { id: 'concreteKing', name: 'Concrete King', kind: 'industry', zones: IND, colors: ['#9e9e9e', '#1565c0'], blurb: 'Feeds the flyovers.', arch: ['factory', 'shed'], weight: 1, tagline: 'WE POUR · YOU PAY', sign: { style: 'box', font: 'Bungee', bg: '#1565c0', fg: '#ffffff', icon: 'crown', sub: 'READY MIX · WE POUR, YOU PAY' } },

  // ================================================================ office
  { id: 'blackrack', name: 'Blackrack Capital', kind: 'office', zones: OFF, colors: ['#111111', '#ffffff'], blurb: 'We bought your neighborhood. Rent is due.', arch: ['glassOffice', 'officeTower'], levels: [2, 5], weight: 2, tagline: 'WE BOUGHT YOUR NEIGHBORHOOD', sign: { style: 'channel', font: 'Overpass', text: 'BLACKRACK', bg: '#111111', fg: '#ffffff', sub: 'CAPITAL · WE OWN YOUR HOUSE' } },
  { id: 'zuckerborg', name: 'Zuckerborg Metaverse', kind: 'office', zones: OFF, colors: ['#0866ff', '#ffffff'], blurb: 'Legs coming Q3.', arch: ['campus', 'officeTower'], levels: [3, 5], weight: 1.5, tagline: 'LEGS COMING Q3', sign: { style: 'channel', font: 'Overpass', text: 'ZUCKERBORG', bg: '#0b1a33', fg: '#ffffff', accent: '#0866ff', sub: 'METAVERSE · LEGS COMING Q3' } },
  { id: 'muskratX', name: 'X Tower', kind: 'office', zones: OFF, colors: ['#000000', '#ffffff'], blurb: 'Elongated Muskrat renamed it again.', arch: ['officeTower'], levels: [4, 5], weight: 1, tagline: 'FORMERLY THE OTHER TOWER', sign: { style: 'channel', font: 'Bungee', text: 'X', bg: '#000000', fg: '#ffffff', sub: 'FORMERLY THE OTHER TOWER' } },
  { id: 'welose', name: 'WeLose Coworking', kind: 'office', zones: OFF, colors: ['#111111', '#ffffff'], blurb: 'Kombucha on tap, bankruptcy on schedule.', arch: ['glassOffice', 'contentFarm'], levels: [1, 3], weight: 1.5, tagline: 'COWORK · COLOSE', sign: { style: 'channel', font: 'Overpass', text: 'welose', bg: '#111111', fg: '#ffffff', sub: 'COWORKING · KOMBUCHA ON TAP' } },
  { id: 'promptBros', name: 'Prompt Bros Institute', kind: 'office', zones: OFF, colors: ['#c6f432', '#111111'], blurb: '10 years of experience in 2-year-old tech.', arch: ['campus', 'glassOffice'], levels: [2, 4], weight: 2, tagline: 'PROMPT ENGINEERING CAMPUS', sign: { style: 'box', font: 'Bungee', text: 'PROMPT BROS', bg: '#111111', fg: '#c6f432', icon: 'chip', sub: 'PROMPT ENGINEERING CAMPUS' } },
  { id: 'slopTokHouse', name: 'SlopTok Content House', kind: 'office', zones: OFF, colors: ['#fe2c55', '#25f4ee'], blurb: 'Six influencers, one ring light.', arch: ['contentFarm'], levels: [1, 2], weight: 2, tagline: 'LIKE · FOLLOW · SUBSCRIBE', sign: { style: 'neon', font: 'Permanent Marker', text: 'CONTENT HOUSE', bg: '#111111', fg: '#25f4ee', accent: '#fe2c55', sub: 'LIKE · FOLLOW · SUBSCRIBE' } },
  { id: 'aiSlopFarm', name: 'Infinite Slop AI Content Farm', kind: 'office', zones: OFF, colors: ['#2b2d42', '#ef233c'], blurb: '40,000 articles a day, none read.', arch: ['contentFarm', 'glassOffice'], levels: [1, 3], weight: 2, tagline: '40,000 ARTICLES A DAY', sign: { style: 'box', font: 'Bungee', text: 'INFINITE SLOP', bg: '#2b2d42', fg: '#ef233c', icon: 'hand7', sub: 'AI CONTENT FARM · 40K POSTS/DAY' } },
  { id: 'synergyPartners', name: 'Synergy Partners LLP', kind: 'office', zones: OFF, colors: ['#1d3557', '#a8dadc'], blurb: 'Chad Brokowski\'s consultancy. Shovel-ready synergy.', arch: ['glassOffice', 'officeTower'], levels: [1, 4], weight: 1.5, tagline: 'SHOVEL-READY SYNERGY', sign: { style: 'channel', font: 'Georgia', text: 'SYNERGY PARTNERS', bg: '#1d3557', fg: '#f1faee', sub: 'SHOVEL-READY SOLUTIONS' } },
  { id: 'dalesLanes', name: "Big Dale's Lane Addition Co.", kind: 'office', zones: OFF, colors: ['#ffb703', '#023047'], blurb: 'One more lane. Always.', arch: ['glassOffice', 'contentFarm'], levels: [1, 3], weight: 1, tagline: 'ONE MORE LANE', sign: { style: 'box', font: 'Anton', text: "BIG DALE'S LANE ADDITION", bg: '#023047', fg: '#ffb703', sub: 'ONE MORE LANE · ALWAYS' } },
];

const FONTS = new Set<string>(['Bungee', 'Anton', 'Titan One', 'Permanent Marker', 'Yellowtail', 'Overpass']);
for (const b of BRANDS) {
  const f = b.sign?.font ?? (b.sign?.style === 'slopScript' ? 'Yellowtail' : 'Bungee');
  b.font ??= (FONTS.has(f) ? f : 'Anton') as SignFont;
}

export function brandById(id: string | undefined): Brand | undefined {
  return id ? BRAND_MAP.get(id) : undefined;
}

const BRAND_MAP = new Map(BRANDS.map((b) => [b.id, b]));

/** Generic signage that isn't a brand (leasing banners etc.). */
export const GENERIC_SIGNS: { id: string; text: string; colors: [string, string]; font: SignFont }[] = [
  { id: 'nowLeasing', text: 'NOW LEASING', colors: ['#1d3557', '#ffffff'], font: 'Anton' },
  { id: 'luxury', text: 'LUXURY LIVING*', colors: ['#f1faee', '#1d3557'], font: 'Overpass' },
  { id: 'forLease', text: 'FOR LEASE', colors: ['#c8102e', '#ffffff'], font: 'Anton' },
  { id: 'open247', text: 'OPEN 24/7', colors: ['#111111', '#ff3b3b'], font: 'Bungee' },
  { id: 'getInCannon', text: 'GET IN THE CANNON', colors: ['#111111', '#c6f432'], font: 'Bungee' },
  { id: 'slopmerica', text: 'SLOPMERICA', colors: ['#f1f1f1', '#1d3a8a'], font: 'Bungee' },
  { id: 'jesusSaves', text: 'JESUS SAVES (15% OFF)', colors: ['#ffffff', '#1d3a8a'], font: 'Anton' },
  { id: 'datacenter', text: 'NEURAL FLY  DATA  DO NOT LICK', colors: ['#0b0f1a', '#6ef0ff'], font: 'Overpass' },
  { id: 'noStroads', text: 'NO STROADS', colors: ['#3a2414', '#fff275'], font: 'Permanent Marker' },
  { id: 'goodVibes', text: 'GOOD VIBES ONLY', colors: ['#2a6a3a', '#fff4e0'], font: 'Permanent Marker' },
];

/** Brands that can occupy an archetype in a zone at a level. */
export function brandsFor(zone: ZoneType, arch: Archetype, level: number): Brand[] {
  return BRANDS.filter((b) => b.zones.includes(zone) && (b.arch ?? []).includes(arch) && (!b.levels || (level >= b.levels[0] && level <= b.levels[1])));
}

/** Short storefront name used on signs (the display text on the sign). */
export function signText(b: Brand) {
  return b.sign?.text ?? b.name;
}
