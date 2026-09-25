import * as THREE from 'three';
import type { PersonAction } from '../contracts';

export type BodyType = 'slim' | 'average' | 'broad' | 'stocky' | 'tall';
export type Outfit = 'tee' | 'hoodie' | 'suit' | 'vest' | 'tank' | 'flannel' | 'overalls' | 'robe' | 'jersey' | 'workwear' | 'raincoat';
export type HairStyle = 'bald' | 'crop' | 'long' | 'ponytail' | 'mohawk' | 'mullet' | 'bun';
export type HatStyle = 'none' | 'ballcap' | 'beanie' | 'cowboy' | 'hardhat' | 'tinfoil' | 'sunhat';
export type PersonProp = 'none' | 'cigarette' | 'beer' | 'vape' | 'phone' | 'sign' | 'drum';
export type FaceStyle = 'plain' | 'smile' | 'scowl' | 'sleepy' | 'shades' | 'glasses' | 'mustache' | 'beard' | 'soyjak' | 'wojak' | 'blush' | 'npc';

export interface Archetype {
  id: string;
  name: string;
  handle: string;
  bio: string;
  lean: 'left' | 'right' | 'center' | 'chaos';
  vices: PersonAction[];
  hippie?: boolean;
  merch?: boolean;
  body?: BodyType;
  outfit?: Outfit;
  hair?: HairStyle;
  hat?: HatStyle;
  prop?: PersonProp;
  face?: FaceStyle;
  nightOwl?: boolean;
  civicRegular?: boolean;
}

/** Comic types aimed at habits, incentives, and internet behavior. */
export const ARCHETYPES: Archetype[] = [
  { id: 'floridaMan', name: 'Florida Man', handle: 'GatorFacts', bio: 'Owns one shirt and three airboats.', lean: 'chaos', vices: ['drink', 'smoke'], body: 'broad', outfit: 'tank', hair: 'mullet', prop: 'beer', face: 'shades', nightOwl: true },
  { id: 'cryptoBro', name: 'Crypto Bro', handle: 'HODL4Life', bio: 'Down 94%. Still early.', lean: 'center', vices: ['vape', 'phone'], body: 'slim', outfit: 'hoodie', hair: 'crop', prop: 'phone', face: 'shades' },
  { id: 'communeHippie', name: 'Commune Hippie', handle: 'SunflowerVibes', bio: 'Has not worn shoes since 2011.', lean: 'left', vices: ['smoke', 'drum', 'yoga'], hippie: true, body: 'slim', outfit: 'vest', hair: 'long', prop: 'drum', face: 'smile' },
  { id: 'hoaPresident', name: 'HOA President Deb', handle: 'CovenantsFirst', bio: 'Can detect a 3.1-inch lawn from orbit.', lean: 'right', vices: ['phone', 'protest'], body: 'average', outfit: 'raincoat', hair: 'bun', prop: 'phone', face: 'glasses', civicRegular: true },
  { id: 'urbanistSkyler', name: 'Urbanist Skyler', handle: 'BollardEnjoyer', bio: 'Brought a chart to a parking-lot fight.', lean: 'left', vices: ['phone', 'protest'], body: 'slim', outfit: 'vest', hair: 'ponytail', prop: 'sign', face: 'glasses', civicRegular: true },
  { id: 'developerChad', name: 'Developer Chad', handle: 'ShovelReady', bio: 'Calls wetlands underperforming acreage.', lean: 'right', vices: ['phone', 'drink'], body: 'broad', outfit: 'suit', hair: 'crop', prop: 'phone', face: 'smile', civicRegular: true },
  { id: 'oldTimerEarl', name: 'Old-Timer Earl', handle: 'BeforeTheBypass', bio: 'Remembers what every retention pond replaced.', lean: 'center', vices: ['sit', 'smoke'], body: 'slim', outfit: 'workwear', hair: 'bald', hat: 'ballcap', prop: 'cigarette', face: 'mustache', civicRegular: true },
  { id: 'pastorRick', name: 'Pastor Rick', handle: 'MoreEasterParking', bio: 'The sermon is short. The parking study is not.', lean: 'right', vices: ['phone', 'protest'], body: 'stocky', outfit: 'suit', hair: 'crop', prop: 'sign', face: 'smile', civicRegular: true },
  { id: 'bigDale', name: 'Big Dale', handle: 'OneMoreLane', bio: 'Has never met a problem under twelve lanes.', lean: 'right', vices: ['drink', 'phone'], body: 'stocky', outfit: 'workwear', hair: 'bald', hat: 'hardhat', prop: 'phone', face: 'mustache' },
  { id: 'karen', name: 'PorchWatch Karen', handle: 'SeenSomething', bio: 'Reports every pedestrian as suspiciously vertical.', lean: 'chaos', vices: ['phone'], body: 'average', outfit: 'flannel', hair: 'crop', prop: 'phone', face: 'glasses', nightOwl: true },
  { id: 'doomer', name: 'Doomer', handle: 'JustOneMoreThread', bio: 'Knows everything that happened and none of why.', lean: 'chaos', vices: ['phone', 'lie'], body: 'slim', outfit: 'hoodie', hair: 'long', prop: 'phone', face: 'wojak', nightOwl: true },
  { id: 'blueCheck', name: 'Blue Check', handle: 'WellActuallyCounty', bio: 'First to arrive, last to read the link.', lean: 'center', vices: ['phone'], body: 'average', outfit: 'tee', hair: 'crop', prop: 'phone', face: 'glasses' },
  { id: 'streamer', name: 'Streamer', handle: 'MicHotCounty', bio: 'Three hours into a point he nearly has.', lean: 'chaos', vices: ['vape', 'phone'], body: 'broad', outfit: 'tee', hair: 'bald', prop: 'vape', face: 'beard', nightOwl: true },
  { id: 'influencer', name: 'Wellness Influencer', handle: 'RawCountyEnergy', bio: 'Sponsored by a powder with legal-adjacent claims.', lean: 'left', vices: ['phone', 'yoga'], body: 'tall', outfit: 'tank', hair: 'ponytail', prop: 'phone', face: 'blush' },
  { id: 'tradWife', name: 'Trad Wife', handle: 'HeritageVinyl', bio: 'Longs for a past recently purchased online.', lean: 'right', vices: ['phone', 'protest'], body: 'average', outfit: 'flannel', hair: 'long', prop: 'sign', face: 'plain' },
  { id: 'mutualAidMod', name: 'Mutual-Aid Moderator', handle: 'ThreadLocked', bio: 'The meeting about the meeting starts at seven.', lean: 'left', vices: ['phone', 'protest'], body: 'slim', outfit: 'hoodie', hair: 'bun', prop: 'phone', face: 'glasses' },
  { id: 'magaGrandpa', name: 'MAGA Grandpa', handle: 'PropaneDoctrine', bio: 'Defends liberty at 500 degrees indirect heat.', lean: 'right', vices: ['drink'], body: 'stocky', outfit: 'tee', hair: 'bald', hat: 'ballcap', prop: 'beer', face: 'mustache' },
  { id: 'protester', name: 'Yard-Sign Protester', handle: 'KindnessParcel', bio: 'Welcomes everyone within setback requirements.', lean: 'left', vices: ['phone', 'protest'], body: 'average', outfit: 'raincoat', hair: 'crop', prop: 'sign', face: 'smile' },
  { id: 'trucker', name: 'Coal-Rolling Trucker', handle: 'TorqueTherapy', bio: 'The truck has a truck for emotional support.', lean: 'right', vices: ['smoke', 'drink'], body: 'broad', outfit: 'workwear', hair: 'mullet', hat: 'ballcap', prop: 'cigarette', face: 'shades' },
  { id: 'bikeLaneDad', name: 'Bike-Lane Dad', handle: 'CargoBikeUnit', bio: 'Can carry six groceries and one zoning argument.', lean: 'left', vices: ['phone'], body: 'tall', outfit: 'vest', hair: 'crop', prop: 'phone', face: 'beard' },
  { id: 'boomer', name: 'Mall-Walking Boomer', handle: 'FoodCourtLaps', bio: 'The anchor store closed. The pace remains elite.', lean: 'center', vices: ['walk', 'drink'], body: 'average', outfit: 'tee', hair: 'bald', prop: 'beer', face: 'smile' },
  { id: 'doorDashDriver', name: 'DoorDash Driver', handle: 'FiveStarsPlease', bio: 'Currently delivering dinner past three dinners.', lean: 'center', vices: ['phone', 'drink'], body: 'slim', outfit: 'hoodie', hair: 'crop', prop: 'phone', face: 'sleepy' },
  { id: 'stanleyCupMom', name: 'Stanley Cup Mom', handle: 'StackTheSavings', bio: 'The cup has a cup for emotional support.', lean: 'center', vices: ['phone'], body: 'stocky', outfit: 'tee', hair: 'bun', prop: 'phone', face: 'glasses' },
  { id: 'prepper', name: 'Suburban Prepper', handle: 'BunkerAdjacent', bio: 'Ready for anything except an HOA inspection.', lean: 'right', vices: ['phone', 'protest'], body: 'broad', outfit: 'vest', hair: 'crop', hat: 'ballcap', prop: 'sign', face: 'beard' },
  { id: 'vanLife', name: 'Van-Life Visionary', handle: 'RoamAndOwe', bio: 'The wilderness has excellent sponsored content.', lean: 'left', vices: ['phone', 'yoga'], body: 'slim', outfit: 'hoodie', hair: 'long', hat: 'beanie', prop: 'phone', face: 'smile' },
  { id: 'promptEngineer', name: 'AI Prompt Engineer', handle: 'DisruptTheCounty', bio: 'Automated the pitch deck. Still hiring a planner.', lean: 'center', vices: ['vape', 'phone'], body: 'tall', outfit: 'hoodie', hair: 'crop', prop: 'vape', face: 'glasses' },
  { id: 'sigmaGrindset', name: 'Sigma Grindset', handle: 'SacredTokens', bio: 'Sells enlightenment in a twelve-part thread.', lean: 'chaos', vices: ['vape', 'phone', 'run'], body: 'slim', outfit: 'robe', hair: 'bun', prop: 'vape', face: 'shades' },
  { id: 'sovereignCitizen', name: 'Sovereign Citizen', handle: 'ConnectTheCones', bio: 'Every cul-de-sac points somewhere.', lean: 'chaos', vices: ['phone', 'protest'], body: 'average', outfit: 'raincoat', hair: 'bald', hat: 'tinfoil', prop: 'sign', face: 'scowl', nightOwl: true },
  { id: 'localJournalist', name: 'Local Journalist', handle: 'CountyDesk', bio: 'Covers six towns and one working printer.', lean: 'center', vices: ['phone'], body: 'slim', outfit: 'raincoat', hair: 'crop', prop: 'phone', face: 'glasses' },
  { id: 'chamberBooster', name: 'Chamber Booster', handle: 'GrowthIsGood', bio: 'Every ribbon is a measurable economic outcome.', lean: 'right', vices: ['phone', 'drink'], body: 'broad', outfit: 'suit', hair: 'crop', prop: 'beer', face: 'smile' },
  { id: 'lineman', name: 'County Lineman', handle: 'LocalAsphalt', bio: 'Restores power before the press conference starts.', lean: 'left', vices: ['smoke', 'drink'], body: 'broad', outfit: 'workwear', hair: 'crop', hat: 'hardhat', prop: 'cigarette', face: 'mustache' },
  { id: 'retiredEngineer', name: 'Retired Engineer', handle: 'DrainageMatters', bio: 'Asked about runoff before runoff was popular.', lean: 'center', vices: ['sit', 'phone'], body: 'slim', outfit: 'vest', hair: 'bald', prop: 'phone', face: 'glasses', civicRegular: true },
  { id: 'schoolBoardStreamer', name: 'School-Board Streamer', handle: 'LiveFromRowTwo', bio: 'Broadcasting the consent agenda like a title fight.', lean: 'chaos', vices: ['phone', 'protest'], body: 'average', outfit: 'tee', hair: 'long', prop: 'phone', face: 'scowl', civicRegular: true },
  { id: 'hunter', name: 'Hunter in Camo', handle: 'NotForSaleYet', bio: 'The subdivision brochure already uses the deer stand.', lean: 'center', vices: ['smoke', 'sit'], body: 'stocky', outfit: 'overalls', hair: 'bald', hat: 'ballcap', prop: 'cigarette', face: 'beard' },
  { id: 'realEstateAgent', name: 'Real Estate Agent', handle: 'UnlockTheVue', bio: 'Every drainage ditch is a water feature.', lean: 'center', vices: ['phone'], body: 'tall', outfit: 'suit', hair: 'ponytail', prop: 'phone', face: 'smile' },
  { id: 'sportsParent', name: 'Travel-Ball Parent', handle: 'TournamentBound', bio: 'The minivan crosses three counties before breakfast.', lean: 'center', vices: ['phone', 'drink'], body: 'average', outfit: 'jersey', hair: 'bun', hat: 'ballcap', prop: 'beer', face: 'sleepy' },
  { id: 'tailgateMayor', name: 'Tailgate Mayor', handle: 'LotBExecutive', bio: 'Governs twelve parking spaces every Saturday.', lean: 'chaos', vices: ['drink', 'dance'], body: 'stocky', outfit: 'jersey', hair: 'mullet', hat: 'ballcap', prop: 'beer', face: 'shades' },
  { id: 'festivalDrummer', name: 'Festival Drummer', handle: 'PocketOfRhythm', bio: 'Has never encountered a quiet public space.', lean: 'left', vices: ['drum', 'dance'], hippie: true, body: 'slim', outfit: 'vest', hair: 'mohawk', prop: 'drum', face: 'smile' },
  { id: 'craftBeerOracle', name: 'Craft-Beer Oracle', handle: 'NotesOfAsphalt', bio: 'Detects notes of citrus and tax increment financing.', lean: 'left', vices: ['drink', 'phone'], body: 'broad', outfit: 'flannel', hair: 'bun', hat: 'beanie', prop: 'beer', face: 'beard' },
  { id: 'energyDrinkIntern', name: 'Energy-Drink Intern', handle: 'SynergyAt2AM', bio: 'Heart rate sponsored by SLOP.', lean: 'center', vices: ['phone', 'dance'], merch: true, body: 'slim', outfit: 'hoodie', hair: 'crop', prop: 'phone', face: 'sleepy', nightOwl: true },
  { id: 'slopMerchHead', name: 'Slop Merch Head', handle: 'GetInTheCannon', bio: 'Owns the drop in three colors and no savings.', lean: 'chaos', vices: ['drink', 'dance'], merch: true, body: 'average', outfit: 'hoodie', hair: 'mullet', hat: 'beanie', prop: 'beer', face: 'shades' },
  { id: 'jerseyCollector', name: 'Slop 69 Collector', handle: 'NiceJersey', bio: 'Calls every purchase an archive acquisition.', lean: 'chaos', vices: ['phone', 'dance'], merch: true, body: 'broad', outfit: 'jersey', hair: 'crop', hat: 'ballcap', prop: 'phone', face: 'smile' },
  { id: 'cannonClub', name: 'Cannon Club Regular', handle: 'ShortFuseSocial', bio: 'Loose cannon. Meticulous bar tab.', lean: 'chaos', vices: ['drink', 'smoke'], merch: true, body: 'stocky', outfit: 'tee', hair: 'bald', prop: 'cigarette', face: 'mustache', nightOwl: true },
  { id: 'beachBro', name: 'Propane Paradise Bro', handle: 'GrillTide', bio: 'Formalwear means the button-up has cannons.', lean: 'center', vices: ['drink', 'dance'], merch: true, body: 'broad', outfit: 'tee', hair: 'long', hat: 'sunhat', prop: 'beer', face: 'shades' },
  { id: 'zoningLawyer', name: 'Zoning Lawyer', handle: 'VarianceEnjoyer', bio: 'Bills by the exception.', lean: 'center', vices: ['phone', 'drink'], body: 'tall', outfit: 'suit', hair: 'crop', prop: 'phone', face: 'glasses', civicRegular: true },
  { id: 'codeEnforcer', name: 'Code Enforcer', handle: 'SetbackUnit', bio: 'Carries a ruler and the burden of civilization.', lean: 'center', vices: ['phone'], body: 'average', outfit: 'workwear', hair: 'bald', hat: 'hardhat', prop: 'phone', face: 'plain' },
  { id: 'roadsidePhilosopher', name: 'Roadside Philosopher', handle: 'ExitRampSage', bio: 'All truths available beside Pump 47.', lean: 'chaos', vices: ['smoke', 'sit'], body: 'slim', outfit: 'robe', hair: 'long', prop: 'cigarette', face: 'beard', nightOwl: true },
  { id: 'golfCartGrandma', name: 'Golf-Cart Grandma', handle: 'StreetLegalIsh', bio: 'Top speed classified as a lifestyle.', lean: 'right', vices: ['drink', 'phone'], body: 'stocky', outfit: 'tee', hair: 'bald', hat: 'sunhat', prop: 'beer', face: 'shades' },
  { id: 'stormChaser', name: 'Parking-Lot Storm Chaser', handle: 'RotationConfirmed', bio: 'Live from beneath the least stable awning.', lean: 'chaos', vices: ['phone', 'run'], body: 'tall', outfit: 'raincoat', hair: 'crop', prop: 'phone', face: 'shades' },
  { id: 'leafBlower', name: 'Leaf-Blower Enthusiast', handle: 'DecibelLawn', bio: 'Moves one leaf through force of character.', lean: 'right', vices: ['drink'], body: 'broad', outfit: 'workwear', hair: 'mullet', hat: 'ballcap', prop: 'beer', face: 'plain' },
  { id: 'pickleballRetiree', name: 'Pickleball Retiree', handle: 'KitchenLine', bio: 'Has converted two tennis courts and four relatives.', lean: 'center', vices: ['phone', 'dance'], body: 'tall', outfit: 'tank', hair: 'crop', hat: 'ballcap', prop: 'phone', face: 'smile' },
  { id: 'remoteWorker', name: 'Remote Worker', handle: 'MutedAgain', bio: 'Lives here. Works somewhere in a tab.', lean: 'left', vices: ['phone', 'vape'], body: 'slim', outfit: 'hoodie', hair: 'bun', prop: 'vape', face: 'glasses' },
  { id: 'fireworksNeighbor', name: 'Fireworks Neighbor', handle: 'TuesdayIsAHoliday', bio: 'Celebrates every available night.', lean: 'chaos', vices: ['drink', 'dance'], body: 'broad', outfit: 'tank', hair: 'mohawk', prop: 'beer', face: 'smile', nightOwl: true },
  { id: 'zuckerborg', name: 'Zuckerborg', handle: 'HumanNeighbor', bio: 'Enjoys normal smoked meats with fellow residents.', lean: 'center', vices: ['phone', 'run'], body: 'slim', outfit: 'tee', hair: 'crop', prop: 'phone', face: 'plain' },
  { id: 'elongatedMuskrat', name: 'Elongated Muskrat', handle: 'DefinitelyMars', bio: 'Promises a tunnel by next quarter.', lean: 'chaos', vices: ['phone', 'fight'], body: 'tall', outfit: 'suit', hair: 'crop', prop: 'phone', face: 'scowl' },
  { id: 'soyBarista', name: 'Soy Barista', handle: 'OatForHere', bio: 'Can foam a zoning take to microbubble texture.', lean: 'left', vices: ['phone', 'protest'], body: 'slim', outfit: 'vest', hair: 'mohawk', prop: 'phone', face: 'soyjak' },
  { id: 'libertarianGunGuy', name: 'Libertarian Gun Guy', handle: 'PermitOptional', bio: 'Opposes regulations except his driveway covenant.', lean: 'right', vices: ['smoke', 'protest'], body: 'broad', outfit: 'vest', hair: 'bald', hat: 'ballcap', prop: 'sign', face: 'shades' },
  { id: 'gymBro', name: 'Gym Bro', handle: 'CountyPR', bio: 'Never skips leg day or a mirror.', lean: 'center', vices: ['phone', 'run'], body: 'broad', outfit: 'tank', hair: 'crop', prop: 'phone', face: 'soyjak' },
  { id: 'vapeKid', name: 'Vape Kid', handle: 'CloudDistrict', bio: 'Produces more fog than the weather system.', lean: 'chaos', vices: ['vape', 'phone'], body: 'slim', outfit: 'hoodie', hair: 'mullet', prop: 'vape', face: 'wojak' },
  { id: 'egirl', name: 'E-girl', handle: 'BufferingAngel', bio: 'Streaming from a room lit entirely in magenta.', lean: 'chaos', vices: ['phone', 'dance'], body: 'slim', outfit: 'hoodie', hair: 'long', prop: 'phone', face: 'blush', nightOwl: true },
  { id: 'skater', name: 'Parking-Lot Skater', handle: 'CurbWaxDept', bio: 'Found the only productive use for the big-box curb.', lean: 'left', vices: ['run', 'sit'], body: 'slim', outfit: 'tee', hair: 'long', hat: 'beanie', prop: 'none', face: 'plain' },
  { id: 'goth', name: 'Goth at Noon', handle: 'BlacktopRomantic', bio: 'The asphalt matches everything.', lean: 'left', vices: ['smoke', 'phone'], body: 'slim', outfit: 'hoodie', hair: 'long', prop: 'cigarette', face: 'sleepy' },
  { id: 'streetPreacher', name: 'Street Preacher', handle: 'MegaphoneRick', bio: 'Needs no microphone and accepts no feedback.', lean: 'right', vices: ['protest'], body: 'tall', outfit: 'suit', hair: 'bald', prop: 'sign', face: 'scowl' },
  { id: 'forestCommunard', name: 'Forest Commune Forager', handle: 'MushroomCouncil', bio: 'The mushrooms voted against the bypass.', lean: 'left', vices: ['yoga', 'smoke'], hippie: true, body: 'slim', outfit: 'robe', hair: 'long', prop: 'cigarette', face: 'smile' },
  { id: 'communeDrummer', name: 'Commune Drum Captain', handle: 'NoDownbeatNoMasters', bio: 'Calls every tempo a consensus process.', lean: 'left', vices: ['drum', 'dance'], hippie: true, body: 'broad', outfit: 'vest', hair: 'bun', prop: 'drum', face: 'beard' },
  { id: 'brainrotKid', name: 'Italian-Brainrot Kid', handle: 'BallerinaCappuccina', bio: 'Speaks fluent algorithm and partial Italian.', lean: 'chaos', vices: ['phone', 'dance'], body: 'slim', outfit: 'jersey', hair: 'mohawk', prop: 'phone', face: 'soyjak' },
  { id: 'npc', name: 'NPC Gray Face', handle: 'CurrentObjective', bio: 'Waiting patiently for dialogue to unlock.', lean: 'center', vices: ['idle', 'walk'], body: 'average', outfit: 'tee', hair: 'bald', prop: 'none', face: 'npc' },
  { id: 'techBro', name: 'Tech Bro', handle: 'DisruptLocal', bio: 'Calls the bus stop a mobility startup.', lean: 'center', vices: ['vape', 'phone'], body: 'slim', outfit: 'hoodie', hair: 'crop', prop: 'phone', face: 'soyjak' },
  { id: 'replyGuy', name: 'Reply Guy', handle: 'WellActuallyAgain', bio: 'First to arrive, last to read the link.', lean: 'center', vices: ['phone'], body: 'average', outfit: 'tee', hair: 'crop', prop: 'phone', face: 'wojak' },
];

const TAU = Math.PI * 2;
const HAIR_COLORS = [0x2b1b15, 0x4a2c1b, 0x8a5a2b, 0xc9a45f, 0xd8d2c4, 0x161616, 0x9b3f2f];
const SKIN_COLORS = [0xf3c9a4, 0xdba276, 0xb97850, 0x895638, 0x603b2a, 0xf0bfa0];
const PANTS_COLORS = [0x283447, 0x393735, 0x45513f, 0x31516a, 0x604f3f, 0x1d2026];
const SHIRT_COLORS = [0x315b73, 0xb64a3c, 0x5d7047, 0xc8913c, 0x6d547d, 0xd7d0bf, 0x303338, 0x8d5b3e];
const BODY: Record<BodyType, { w: number; h: number; d: number }> = {
  slim: { w: 0.82, h: 1, d: 0.82 }, average: { w: 1, h: 1, d: 1 }, broad: { w: 1.2, h: 1.02, d: 1.08 },
  stocky: { w: 1.18, h: 0.9, d: 1.13 }, tall: { w: 0.93, h: 1.13, d: 0.94 },
};

interface Pose {
  bob: number; torsoPitch: number; torsoRoll: number;
  leftLeg: number; rightLeg: number; leftCalf: number; rightCalf: number;
  leftArm: number; rightArm: number; leftFore: number; rightFore: number;
  leftSide: number; rightSide: number; crouch: number; rootPitch: number; rootRoll: number;
}

function unitCylinder(radialSegments = 6): THREE.CylinderGeometry { return new THREE.CylinderGeometry(1, 1, 1, radialSegments); }
function standardMaterial(roughness = 0.82): THREE.MeshStandardMaterial { return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness }); }

function buildFaceAtlas(): THREE.CanvasTexture {
  const cell = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 9;
  const c = canvas.getContext('2d')!;
  c.lineCap = c.lineJoin = 'round';
  for (let i = 0; i < 81; i++) {
    const style = ARCHETYPES[i % ARCHETYPES.length].face ?? 'plain';
    c.save(); c.translate((i % 9) * cell, Math.floor(i / 9) * cell);
    c.strokeStyle = c.fillStyle = '#211b19'; c.lineWidth = 4;
    if (style === 'shades') { c.fillRect(12, 19, 17, 11); c.fillRect(35, 19, 17, 11); c.fillRect(28, 22, 8, 3); }
    else if (style === 'glasses') { c.strokeRect(11, 18, 18, 13); c.strokeRect(35, 18, 18, 13); c.beginPath(); c.moveTo(29, 23); c.lineTo(35, 23); c.stroke(); c.fillRect(19, 22, 3, 4); c.fillRect(43, 22, 3, 4); }
    else if (style === 'sleepy') { c.beginPath(); c.moveTo(14, 25); c.lineTo(27, 24); c.moveTo(37, 24); c.lineTo(50, 25); c.stroke(); }
    else if (style === 'soyjak') { c.beginPath(); c.arc(20, 23, 5, 0, TAU); c.arc(44, 23, 5, 0, TAU); c.stroke(); c.beginPath(); c.ellipse(32, 45, 9, 12, 0, 0, TAU); c.stroke(); }
    else if (style === 'wojak') { c.lineWidth = 3; c.beginPath(); c.ellipse(20, 25, 5, 7, 0, 0, TAU); c.ellipse(44, 25, 5, 7, 0, 0, TAU); c.stroke(); c.fillRect(19, 25, 2, 3); c.fillRect(43, 25, 2, 3); }
    else { c.beginPath(); c.arc(21, 24, 2.7, 0, TAU); c.arc(43, 24, 2.7, 0, TAU); c.fill(); if (style === 'scowl') { c.beginPath(); c.moveTo(13, 17); c.lineTo(27, 20); c.moveTo(37, 20); c.lineTo(51, 17); c.stroke(); } }
    c.lineWidth = 3.5; c.beginPath();
    if (style === 'smile') c.arc(32, 34, 13, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (style === 'scowl') c.arc(32, 49, 11, 1.15 * Math.PI, 1.85 * Math.PI);
    else if (style === 'soyjak') { c.moveTo(32, 45); }
    else if (style === 'wojak') { c.moveTo(24, 45); c.quadraticCurveTo(32, 41, 40, 45); }
    else { c.moveTo(25, 43); c.lineTo(39, 43); }
    c.stroke();
    if (style === 'blush') { c.fillStyle = '#e77d8d'; c.globalAlpha = 0.55; c.beginPath(); c.ellipse(14, 35, 7, 4, 0, 0, TAU); c.ellipse(50, 35, 7, 4, 0, 0, TAU); c.fill(); c.globalAlpha = 1; }
    if (style === 'npc') { c.lineWidth = 5; c.beginPath(); c.moveTo(21, 43); c.lineTo(43, 43); c.stroke(); }
    if (style === 'mustache') { c.beginPath(); c.moveTo(32, 38); c.quadraticCurveTo(24, 33, 18, 40); c.quadraticCurveTo(25, 43, 32, 39); c.quadraticCurveTo(39, 43, 46, 40); c.quadraticCurveTo(40, 33, 32, 38); c.fill(); }
    else if (style === 'beard') { c.globalAlpha = 0.82; c.beginPath(); c.moveTo(16, 34); c.quadraticCurveTo(18, 59, 32, 61); c.quadraticCurveTo(46, 59, 48, 34); c.quadraticCurveTo(39, 43, 32, 44); c.quadraticCurveTo(25, 43, 16, 34); c.fill(); }
    c.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter;
  return texture;
}

function faceMaterial(texture: THREE.Texture): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    uniforms: { map: { value: texture } }, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: `precision highp float; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv; attribute mat4 instanceMatrix; attribute float faceCell; varying vec2 vUv; varying float vCell; void main(){vUv=uv;vCell=faceCell;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader: `precision highp float; uniform sampler2D map; varying vec2 vUv; varying float vCell; void main(){float col=mod(vCell,9.0);float row=floor(vCell/9.0);vec4 ink=texture2D(map,vec2((vUv.x+col)/9.0,(vUv.y+(8.0-row))/9.0));if(ink.a<0.1)discard;gl_FragColor=ink;}`,
  });
}

function buildLogoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const c = canvas.getContext('2d')!; c.fillStyle = '#efe6cf'; c.font = 'italic 72px Yellowtail, cursive'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Slop', 125, 59);
  c.strokeStyle = '#efe6cf'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(44, 96); c.quadraticCurveTo(140, 116, 222, 88); c.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class PeopleRenderer {
  readonly object = new THREE.Group();
  private readonly free: number[] = [];
  private readonly alive: Uint8Array;
  private readonly archetypes: Uint8Array;
  private used = 0;

  private readonly torso: THREE.InstancedMesh;
  private readonly jacket: THREE.InstancedMesh;
  private readonly skirt: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly face: THREE.InstancedMesh;
  private readonly hairCap: THREE.InstancedMesh;
  private readonly hairBack: THREE.InstancedMesh;
  private readonly hairAccent: THREE.InstancedMesh;
  private readonly hatCrown: THREE.InstancedMesh;
  private readonly hatBrim: THREE.InstancedMesh;
  private readonly foilHat: THREE.InstancedMesh;
  private readonly glasses: THREE.InstancedMesh;
  private readonly hoodieLogo: THREE.InstancedMesh;
  private readonly leftUpperArm: THREE.InstancedMesh;
  private readonly rightUpperArm: THREE.InstancedMesh;
  private readonly leftForearm: THREE.InstancedMesh;
  private readonly rightForearm: THREE.InstancedMesh;
  private readonly leftHand: THREE.InstancedMesh;
  private readonly rightHand: THREE.InstancedMesh;
  private readonly leftThigh: THREE.InstancedMesh;
  private readonly rightThigh: THREE.InstancedMesh;
  private readonly leftCalf: THREE.InstancedMesh;
  private readonly rightCalf: THREE.InstancedMesh;
  private readonly leftShoe: THREE.InstancedMesh;
  private readonly rightShoe: THREE.InstancedMesh;
  private readonly propBox: THREE.InstancedMesh;
  private readonly propCylinder: THREE.InstancedMesh;
  private readonly propPole: THREE.InstancedMesh;
  private readonly ember: THREE.InstancedMesh;

  private readonly allMeshes: THREE.InstancedMesh[] = [];
  private readonly pickMeshes: THREE.InstancedMesh[];
  private readonly hits: THREE.Intersection[] = [];
  private readonly faceCells: THREE.InstancedBufferAttribute;
  private readonly cigaretteMaterial: THREE.MeshStandardMaterial;

  private readonly root = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly rootQuat = new THREE.Quaternion();
  private readonly tiltQuat = new THREE.Quaternion();
  private readonly segmentDir = new THREE.Vector3();
  private readonly segmentMid = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly pose: Pose = {
    bob: 0, torsoPitch: 0, torsoRoll: 0, leftLeg: 0, rightLeg: 0, leftCalf: 0, rightCalf: 0,
    leftArm: 0, rightArm: 0, leftFore: 0, rightFore: 0, leftSide: 0, rightSide: 0,
    crouch: 0, rootPitch: 0, rootRoll: 0,
  };

  constructor(scene: THREE.Scene, private readonly max: number) {
    this.alive = new Uint8Array(max);
    this.archetypes = new Uint8Array(max);
    const limb = unitCylinder(5);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(1, 7, 5);
    const plane = new THREE.PlaneGeometry(1, 1);
    const crown = unitCylinder(8);
    const brim = new THREE.CylinderGeometry(1, 1, 0.12, 10);
    const clothes = standardMaterial();
    const skin = standardMaterial(0.9);
    const pants = standardMaterial();
    const dark = standardMaterial();
    const hair = standardMaterial(0.9);
    const accessory = standardMaterial();

    this.torso = this.makeMesh(box, clothes);
    this.jacket = this.makeMesh(box, clothes);
    this.skirt = this.makeMesh(new THREE.CylinderGeometry(0.72, 1, 1, 6), clothes);
    this.head = this.makeMesh(sphere, skin);
    const faceGeometry = plane.clone();
    this.faceCells = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    faceGeometry.setAttribute('faceCell', this.faceCells);
    this.face = this.makeMesh(faceGeometry, faceMaterial(buildFaceAtlas()));
    this.hairCap = this.makeMesh(sphere, hair);
    this.hairBack = this.makeMesh(box, hair);
    this.hairAccent = this.makeMesh(crown, hair);
    this.hatCrown = this.makeMesh(crown, accessory);
    this.hatBrim = this.makeMesh(brim, accessory);
    this.foilHat = this.makeMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: 0xbfc5ca, metalness: 0.72, roughness: 0.35 }));
    this.glasses = this.makeMesh(box, dark);
    this.hoodieLogo = this.makeMesh(plane.clone(), new THREE.MeshBasicMaterial({ map: buildLogoTexture(), transparent: true, alphaTest: 0.08, side: THREE.DoubleSide }));
    this.leftUpperArm = this.makeMesh(limb, clothes); this.rightUpperArm = this.makeMesh(limb, clothes);
    this.leftForearm = this.makeMesh(limb, skin); this.rightForearm = this.makeMesh(limb, skin);
    this.leftHand = this.makeMesh(box, skin); this.rightHand = this.makeMesh(box, skin);
    this.leftThigh = this.makeMesh(limb, pants); this.rightThigh = this.makeMesh(limb, pants);
    this.leftCalf = this.makeMesh(limb, pants); this.rightCalf = this.makeMesh(limb, pants);
    this.leftShoe = this.makeMesh(box, dark); this.rightShoe = this.makeMesh(box, dark);
    this.propBox = this.makeMesh(box, accessory);
    this.propCylinder = this.makeMesh(crown, accessory);
    this.propPole = this.makeMesh(limb, accessory);
    this.cigaretteMaterial = new THREE.MeshStandardMaterial({ color: 0xeee5ce, roughness: 0.75, emissive: 0xff3b0a, emissiveIntensity: 0.25 });
    this.ember = this.makeMesh(sphere, this.cigaretteMaterial);
    this.pickMeshes = [this.torso, this.head];
    for (let i = 0; i < max; i++) this.hideSlot(i);
    this.object.name = 'people';
    scene.add(this.object);
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, this.max);
    mesh.count = this.max; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.allMeshes.push(mesh); this.object.add(mesh);
    return mesh;
  }

  private hideSlot(h: number): void {
    for (let i = 0; i < this.allMeshes.length; i++) this.allMeshes[i].setMatrixAt(h, this.hidden);
  }

  private setColor(mesh: THREE.InstancedMesh, h: number, hex: number): void {
    mesh.setColorAt(h, this.color.setHex(hex));
  }

  add(archetype: number, seed: number): number {
    const h = this.free.length ? this.free.pop()! : this.used < this.max ? this.used++ : -1;
    if (h < 0) return -1;
    const ai = ((archetype % ARCHETYPES.length) + ARCHETYPES.length) % ARCHETYPES.length;
    const a = ARCHETYPES[ai];
    const s = seed >>> 0;
    this.alive[h] = 1; this.archetypes[h] = ai;
    const skin = a.face === 'npc' ? 0x8b9093 : SKIN_COLORS[(s >>> 3) % SKIN_COLORS.length];
    const hair = HAIR_COLORS[(s >>> 7) % HAIR_COLORS.length];
    const pants = PANTS_COLORS[(s >>> 11) % PANTS_COLORS.length];
    const shirt = a.merch ? 0x171717 : SHIRT_COLORS[(s >>> 15) % SHIRT_COLORS.length];
    const jacket = a.outfit === 'suit' ? 0x252b36 : a.outfit === 'raincoat' ? 0xd4a72c : shirt;
    const hat = a.merch ? 0x171717 : SHIRT_COLORS[(s >>> 19) % SHIRT_COLORS.length];
    this.setColor(this.head, h, skin); this.setColor(this.leftForearm, h, skin); this.setColor(this.rightForearm, h, skin); this.setColor(this.leftHand, h, skin); this.setColor(this.rightHand, h, skin);
    this.setColor(this.torso, h, shirt); this.setColor(this.jacket, h, jacket); this.setColor(this.skirt, h, shirt);
    this.setColor(this.leftUpperArm, h, shirt); this.setColor(this.rightUpperArm, h, shirt);
    this.setColor(this.leftThigh, h, pants); this.setColor(this.rightThigh, h, pants); this.setColor(this.leftCalf, h, pants); this.setColor(this.rightCalf, h, pants);
    this.setColor(this.leftShoe, h, 0x292827); this.setColor(this.rightShoe, h, 0x292827);
    this.setColor(this.hairCap, h, hair); this.setColor(this.hairBack, h, hair); this.setColor(this.hairAccent, h, hair);
    this.setColor(this.hatCrown, h, hat); this.setColor(this.hatBrim, h, hat); this.setColor(this.glasses, h, 0x18191b);
    this.setColor(this.propBox, h, a.prop === 'sign' ? 0xeee2bb : 0x1c2227);
    this.setColor(this.propCylinder, h, a.prop === 'beer' ? 0xc6f432 : a.prop === 'drum' ? 0xb3202a : 0xe9dfc4);
    this.setColor(this.propPole, h, 0x70523a);
    this.faceCells.setX(h, ai);
    this.hideSlot(h);
    return h;
  }

  remove(h: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.alive[h] = 0; this.hideSlot(h); this.free.push(h);
  }

  private setPart(mesh: THREE.InstancedMesh, h: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void {
    this.pos.set(x, y, z); this.quat.setFromEuler(this.euler.set(rx, ry, rz, 'XYZ')); this.scale.set(sx, sy, sz);
    this.local.compose(this.pos, this.quat, this.scale); this.world.multiplyMatrices(this.root, this.local); mesh.setMatrixAt(h, this.world);
  }

  private setSegment(mesh: THREE.InstancedMesh, h: number, sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, radius: number): void {
    this.segmentDir.set(ex - sx, ey - sy, ez - sz);
    const length = this.segmentDir.length();
    this.segmentMid.set((sx + ex) * 0.5, (sy + ey) * 0.5, (sz + ez) * 0.5);
    this.quat.setFromUnitVectors(this.yAxis, this.segmentDir.multiplyScalar(1 / Math.max(length, 0.0001)));
    this.scale.set(radius, length, radius); this.local.compose(this.segmentMid, this.quat, this.scale);
    this.world.multiplyMatrices(this.root, this.local); mesh.setMatrixAt(h, this.world);
  }

  private limbEnd(sx: number, sy: number, sz: number, length: number, sagittal: number, lateral: number, side: number): THREE.Vector3 {
    const lc = Math.cos(lateral);
    return this.pos.set(sx + side * Math.sin(lateral) * length, sy - Math.cos(sagittal) * lc * length, sz + Math.sin(sagittal) * lc * length);
  }

  private calculatePose(action: PersonAction, t: number): Pose {
    const p = this.pose;
    p.bob = p.torsoPitch = p.torsoRoll = p.leftLeg = p.rightLeg = p.leftCalf = p.rightCalf = 0;
    p.leftArm = p.rightArm = p.leftFore = p.rightFore = p.leftSide = p.rightSide = 0;
    p.crouch = p.rootPitch = p.rootRoll = 0;
    const s = Math.sin(t), c = Math.cos(t);
    switch (action) {
      case 'walk': p.leftLeg = s * 0.55; p.rightLeg = -p.leftLeg; p.leftCalf = Math.max(0, -s) * 0.55; p.rightCalf = Math.max(0, s) * 0.55; p.leftArm = -s * 0.45; p.rightArm = s * 0.45; p.bob = Math.abs(c) * 0.035; break;
      case 'run': p.leftLeg = s * 0.9; p.rightLeg = -p.leftLeg; p.leftCalf = 0.25 + Math.max(0, -s) * 0.9; p.rightCalf = 0.25 + Math.max(0, s) * 0.9; p.leftArm = -s * 0.8; p.rightArm = s * 0.8; p.leftFore = p.leftArm + 0.65; p.rightFore = p.rightArm + 0.65; p.torsoPitch = 0.18; p.bob = Math.abs(c) * 0.07; break;
      case 'idle': p.bob = s * 0.008; p.torsoRoll = s * 0.015; break;
      case 'smoke': p.rightArm = 1.82 + s * 0.05; p.rightFore = 2.38 + s * 0.04; p.leftSide = 0.08; p.torsoRoll = -0.035; break;
      case 'drink': p.rightArm = 1.7 + s * 0.08; p.rightFore = 2.5 + s * 0.05; p.torsoPitch = -0.025; break;
      case 'vape': p.rightArm = 1.75; p.rightFore = 2.45; p.leftArm = 0.15; p.torsoRoll = -0.02; break;
      case 'phone': p.rightArm = 1.22 + s * 0.025; p.rightFore = 1.82; p.leftArm = 1.15; p.leftFore = 1.7; p.torsoPitch = 0.12; break;
      case 'protest': p.rightArm = 2.95 + s * 0.08; p.rightFore = 3.02; p.leftArm = 2.65 - s * 0.08; p.leftFore = 2.9; p.bob = Math.max(0, s) * 0.035; break;
      case 'dance': p.leftLeg = s * 0.35; p.rightLeg = -s * 0.35; p.leftSide = 0.75 + c * 0.45; p.rightSide = 0.75 - c * 0.45; p.leftArm = 2.25 + s * 0.5; p.rightArm = 2.25 - s * 0.5; p.leftFore = p.leftArm; p.rightFore = p.rightArm; p.torsoRoll = s * 0.16; p.bob = Math.abs(c) * 0.06; break;
      case 'drum': p.leftArm = 1.05 + Math.max(0, s) * 0.45; p.rightArm = 1.05 + Math.max(0, -s) * 0.45; p.leftFore = 1.52 + Math.max(0, s) * 0.6; p.rightFore = 1.52 + Math.max(0, -s) * 0.6; p.bob = s * 0.018; break;
      case 'yoga': p.leftSide = 1.5; p.rightSide = 1.5; p.leftArm = s * 0.04; p.rightArm = -s * 0.04; p.leftLeg = 0.08; p.rightLeg = -0.08; p.torsoRoll = s * 0.025; break;
      case 'sit': p.crouch = 0.4; p.leftLeg = p.rightLeg = 1.48; p.leftArm = p.rightArm = 0.65; p.leftFore = p.rightFore = 0.25; break;
      case 'lie': p.rootPitch = Math.PI * 0.5; p.rootRoll = 0.08 * s; p.leftSide = p.rightSide = 1.15; p.leftLeg = 0.08; p.rightLeg = -0.08; break;
      case 'fight': p.crouch = 0.09 + Math.abs(s) * 0.04; p.torsoPitch = 0.16; p.torsoRoll = s * 0.08; p.leftArm = 1.2 + Math.max(0, s) * 0.9; p.rightArm = 1.2 + Math.max(0, -s) * 0.9; p.leftFore = p.rightFore = 2.15; p.leftSide = p.rightSide = 0.25; p.leftLeg = -0.2; p.rightLeg = 0.25; break;
    }
    return p;
  }

  set(h: number, x: number, y: number, z: number, yaw: number, action: PersonAction, phase: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    const a = ARCHETYPES[this.archetypes[h]];
    const body = BODY[a.body ?? 'average'];
    const p = this.calculatePose(action, phase * TAU);
    const H = body.h, W = body.w, D = body.d;
    this.rootQuat.setFromAxisAngle(this.yAxis, yaw);
    this.tiltQuat.setFromEuler(this.euler.set(p.rootPitch, 0, p.rootRoll, 'XYZ'));
    this.rootQuat.multiply(this.tiltQuat);
    this.root.compose(this.pos.set(x, y + (action === 'lie' ? 0.2 : p.bob), z), this.rootQuat, this.scale.set(1, 1, 1));

    const hipY = (1.01 - p.crouch) * H, shoulderY = (1.55 - p.crouch) * H;
    const torsoY = (1.3 - p.crouch) * H, headY = (1.76 - p.crouch) * H;
    const legX = 0.13 * W, shoulderX = 0.29 * W;
    const thighLength = 0.44 * H, calfLength = 0.43 * H, upperLength = 0.33 * H, foreLength = 0.31 * H;

    this.setPart(this.torso, h, 0, torsoY, 0, p.torsoPitch, 0, p.torsoRoll, 0.45 * W, 0.62 * H, 0.26 * D);
    const layered = a.outfit === 'suit' || a.outfit === 'flannel' || a.outfit === 'raincoat' || a.outfit === 'vest' || a.outfit === 'workwear';
    if (layered) this.setPart(this.jacket, h, 0, torsoY + 0.005, -0.002, p.torsoPitch, 0, p.torsoRoll, 0.48 * W, 0.56 * H, 0.28 * D);
    else this.jacket.setMatrixAt(h, this.hidden);
    if (a.outfit === 'robe') this.setPart(this.skirt, h, 0, 0.96 * H - p.crouch * H, 0, 0, 0, 0, 0.31 * W, 0.48 * H, 0.31 * D);
    else this.skirt.setMatrixAt(h, this.hidden);

    const lk = this.limbEnd(-legX, hipY, 0, thighLength, p.leftLeg, 0.02, -1);
    const lkx = lk.x, lky = lk.y, lkz = lk.z;
    this.setSegment(this.leftThigh, h, -legX, hipY, 0, lkx, lky, lkz, 0.105 * W);
    const la = this.limbEnd(lkx, lky, lkz, calfLength, p.leftCalf, 0, -1);
    const lax = la.x, lay = la.y, laz = la.z;
    this.setSegment(this.leftCalf, h, lkx, lky, lkz, lax, lay, laz, 0.09 * W);
    this.setPart(this.leftShoe, h, lax, lay - 0.02, laz + 0.065, 0, 0, 0, 0.2 * W, 0.11 * H, 0.33 * D);
    const rk = this.limbEnd(legX, hipY, 0, thighLength, p.rightLeg, 0.02, 1);
    const rkx = rk.x, rky = rk.y, rkz = rk.z;
    this.setSegment(this.rightThigh, h, legX, hipY, 0, rkx, rky, rkz, 0.105 * W);
    const ra = this.limbEnd(rkx, rky, rkz, calfLength, p.rightCalf, 0, 1);
    const rax = ra.x, ray = ra.y, raz = ra.z;
    this.setSegment(this.rightCalf, h, rkx, rky, rkz, rax, ray, raz, 0.09 * W);
    this.setPart(this.rightShoe, h, rax, ray - 0.02, raz + 0.065, 0, 0, 0, 0.2 * W, 0.11 * H, 0.33 * D);

    const le = this.limbEnd(-shoulderX, shoulderY, 0, upperLength, p.leftArm, p.leftSide, -1);
    const lex = le.x, ley = le.y, lez = le.z;
    this.setSegment(this.leftUpperArm, h, -shoulderX, shoulderY, 0, lex, ley, lez, 0.078 * W);
    const lh = this.limbEnd(lex, ley, lez, foreLength, p.leftFore, p.leftSide * 0.25, -1);
    const lhx = lh.x, lhy = lh.y, lhz = lh.z;
    this.setSegment(this.leftForearm, h, lex, ley, lez, lhx, lhy, lhz, 0.067 * W);
    this.setPart(this.leftHand, h, lhx, lhy, lhz, p.leftFore, 0, 0, 0.12 * W, 0.12 * H, 0.1 * D);
    const re = this.limbEnd(shoulderX, shoulderY, 0, upperLength, p.rightArm, p.rightSide, 1);
    const rex = re.x, rey = re.y, rez = re.z;
    this.setSegment(this.rightUpperArm, h, shoulderX, shoulderY, 0, rex, rey, rez, 0.078 * W);
    const rh = this.limbEnd(rex, rey, rez, foreLength, p.rightFore, p.rightSide * 0.25, 1);
    const rhx = rh.x, rhy = rh.y, rhz = rh.z;
    this.setSegment(this.rightForearm, h, rex, rey, rez, rhx, rhy, rhz, 0.067 * W);
    this.setPart(this.rightHand, h, rhx, rhy, rhz, p.rightFore, 0, 0, 0.12 * W, 0.12 * H, 0.1 * D);

    this.setPart(this.head, h, 0, headY, 0.005, p.torsoPitch * 0.25, 0, p.torsoRoll * 0.3, 0.225 * W, 0.25 * H, 0.215 * D);
    this.setPart(this.face, h, 0, headY - 0.005, 0.218 * D, 0, 0, 0, 0.37 * W, 0.37 * H, 1);
    const hairStyle = a.hair ?? 'crop';
    if (hairStyle !== 'bald') this.setPart(this.hairCap, h, 0, headY + 0.11 * H, -0.018, 0, 0, 0, 0.232 * W, 0.155 * H, 0.222 * D);
    else this.hairCap.setMatrixAt(h, this.hidden);
    if (hairStyle === 'long' || hairStyle === 'mullet') this.setPart(this.hairBack, h, 0, headY - 0.12 * H, -0.18 * D, 0, 0, 0, hairStyle === 'mullet' ? 0.15 * W : 0.22 * W, hairStyle === 'mullet' ? 0.3 * H : 0.48 * H, 0.08 * D);
    else this.hairBack.setMatrixAt(h, this.hidden);
    if (hairStyle === 'ponytail') this.setPart(this.hairAccent, h, 0, headY - 0.08 * H, -0.28 * D, Math.PI * 0.5, 0, 0, 0.075, 0.32 * H, 0.075);
    else if (hairStyle === 'mohawk') this.setPart(this.hairAccent, h, 0, headY + 0.27 * H, -0.01, 0, 0, 0, 0.075, 0.35 * H, 0.11);
    else if (hairStyle === 'bun') this.setPart(this.hairAccent, h, 0, headY + 0.16 * H, -0.21 * D, 0, 0, 0, 0.12, 0.16 * H, 0.12);
    else this.hairAccent.setMatrixAt(h, this.hidden);

    const hat = a.hat ?? 'none';
    if (hat !== 'none' && hat !== 'tinfoil') {
      const wide = hat === 'cowboy' || hat === 'sunhat';
      this.setPart(this.hatCrown, h, 0, headY + 0.235 * H, -0.01, 0, 0, 0, wide ? 0.19 * W : 0.21 * W, hat === 'beanie' ? 0.22 * H : 0.18 * H, wide ? 0.16 * D : 0.2 * D);
      if (hat !== 'beanie' && hat !== 'hardhat') this.setPart(this.hatBrim, h, 0, headY + 0.18 * H, hat === 'ballcap' ? 0.12 * D : 0, 0, 0, 0, wide ? 0.37 * W : 0.26 * W, 0.06, wide ? 0.33 * D : 0.25 * D);
      else this.hatBrim.setMatrixAt(h, this.hidden);
    } else { this.hatCrown.setMatrixAt(h, this.hidden); this.hatBrim.setMatrixAt(h, this.hidden); }
    if (hat === 'tinfoil') this.setPart(this.foilHat, h, 0, headY + 0.32 * H, 0, 0, 0, 0, 0.22 * W, 0.36 * H, 0.22 * D);
    else this.foilHat.setMatrixAt(h, this.hidden);
    if (a.face === 'glasses' || a.face === 'shades') this.setPart(this.glasses, h, 0, headY + 0.045 * H, 0.231 * D, 0, 0, 0, 0.4 * W, 0.075 * H, 0.035);
    else this.glasses.setMatrixAt(h, this.hidden);
    if (a.merch && a.outfit === 'hoodie') this.setPart(this.hoodieLogo, h, 0, torsoY + 0.02, -0.143 * D, 0, Math.PI, 0, 0.34 * W, 0.23 * H, 1);
    else this.hoodieLogo.setMatrixAt(h, this.hidden);

    this.propBox.setMatrixAt(h, this.hidden); this.propCylinder.setMatrixAt(h, this.hidden); this.propPole.setMatrixAt(h, this.hidden); this.ember.setMatrixAt(h, this.hidden);
    const prop: PersonProp = action === 'smoke' ? 'cigarette' : action === 'drink' ? 'beer' : action === 'vape' ? 'vape' : action === 'phone' ? 'phone' : action === 'protest' ? 'sign' : action === 'drum' ? 'drum' : a.prop ?? 'none';
    if (prop === 'phone') this.setPart(this.propBox, h, rhx, rhy + 0.035, rhz + 0.025, -0.25, 0, 0, 0.105, 0.17, 0.025);
    else if (prop === 'vape') this.setPart(this.propBox, h, rhx, rhy + 0.025, rhz + 0.02, -0.1, 0, 0, 0.045, 0.17, 0.045);
    else if (prop === 'beer') this.setPart(this.propCylinder, h, rhx, rhy + 0.04, rhz + 0.02, 0, 0, 0, 0.065, 0.2, 0.065);
    else if (prop === 'cigarette') {
      this.setPart(this.propPole, h, rhx, rhy + 0.015, rhz + 0.055, Math.PI * 0.5, 0, 0, 0.018, 0.16, 0.018);
      this.setPart(this.ember, h, rhx, rhy + 0.015, rhz + 0.135, 0, 0, 0, 0.027, 0.027, 0.027);
    } else if (prop === 'sign') {
      const sway = Math.sin(phase * TAU) * 0.05;
      this.setPart(this.propPole, h, rhx, 1.72 * H - p.crouch * H, rhz, 0, 0, sway, 0.025, 1.35 * H, 0.025);
      this.setPart(this.propBox, h, rhx, 2.25 * H - p.crouch * H, rhz, 0, 0, sway, 0.64 * W, 0.4 * H, 0.045);
    } else if (prop === 'drum') this.setPart(this.propCylinder, h, 0, 1.06 * H - p.crouch * H, 0.31 * D, Math.PI * 0.5, 0, 0, 0.25 * W, 0.34 * D, 0.25 * W);
  }

  setNight(n: number): void {
    const night = THREE.MathUtils.clamp(n, 0, 1);
    this.cigaretteMaterial.emissiveIntensity = 0.25 + night * 4.5;
    this.cigaretteMaterial.color.setRGB(1, 0.88 + night * 0.08, 0.72 - night * 0.35);
  }

  flush(): void {
    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.faceCells.needsUpdate = true;
  }

  pick(ray: THREE.Raycaster): number | null {
    this.hits.length = 0;
    ray.intersectObjects(this.pickMeshes, false, this.hits);
    for (let i = 0; i < this.hits.length; i++) {
      const id = this.hits[i].instanceId;
      if (id !== undefined && this.alive[id] !== 0) return id;
    }
    return null;
  }
}
