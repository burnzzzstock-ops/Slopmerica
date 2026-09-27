// Satire signage: yard signs, vinyl banners, church-style letter boards,
// neon, road signs, chalkboard sidewalk signs and a few painted decals.
// Everything lives on its own sheet ('sat', 2048²) so the main atlas keeps
// its resolution; only neon glows at night. The prop catalog
// (buildings/satire.ts) picks slogans from these lists by key.
import { defTile, type Layer } from './atlas';
import { F, textFit, linesFit, rr, fillStroke, shade, circle, stripes, type Ctx } from './draw';

/** Corrugated-plastic yard signs (and bandit signs zip-tied to poles). */
export const YARD: { k: string; lines: string[]; bg: string; fg: string }[] = [
  { k: 'liveLaughLoan', lines: ['LIVE', 'LAUGH', 'LOAN'], bg: '#f4efe4', fg: '#3b2a1a' },
  { k: 'thoughts', lines: ['THOUGHTS', '& PRAYERS'], bg: '#1d3a8a', fg: '#ffffff' },
  { k: 'noSolicit', lines: ['NO SOLICITING', '(EXCEPT JESUS)'], bg: '#ffffff', fg: '#b3151d' },
  { k: 'wife', lines: ['BEWARE', 'OF WIFE'], bg: '#f2c230', fg: '#111111' },
  { k: 'science', lines: ['THIS HOUSE', 'BELIEVES IN SCIENCE*', '*SOME RESTRICTIONS'], bg: '#2a6f3a', fg: '#ffffff' },
  { k: 'hoaBeige', lines: ['HOA APPROVED', 'BEIGE'], bg: '#d9c9a8', fg: '#4a3a24' },
  { k: 'weBuy', lines: ['WE BUY HOUSES', 'CA$H 555-0199'], bg: '#ffe600', fg: '#d0101a' },
  { k: 'reduced', lines: ['PRICE REDUCED', 'AGAIN'], bg: '#ffffff', fg: '#c01818' },
  { k: 'fsbo', lines: ['FOR SALE', 'BY OWNER', '(DESPERATE)'], bg: '#ffffff', fg: '#1d1d1f' },
  { k: 'openHouse', lines: ['OPEN HOUSE', 'BRING OFFERS', 'ANY OFFERS'], bg: '#0b4f8a', fg: '#ffffff' },
  { k: 'chad', lines: ['VOTE', 'CHAD', '2028'], bg: '#c01818', fg: '#ffffff' },
  { k: 'voteNo', lines: ['VOTE NO', 'ON WHATEVER', 'THAT IS'], bg: '#1d3a8a', fg: '#ffffff' },
  { k: 'reelect', lines: ['RE-ELECT', 'NOBODY'], bg: '#ffffff', fg: '#1d3a8a' },
  { k: 'slowKids', lines: ['SLOW DOWN', 'FREE-RANGE', 'KIDS'], bg: '#9ee34a', fg: '#111111' },
  { k: 'astroturf', lines: ['KEEP OFF GRASS', "(IT'S ASTROTURF)"], bg: '#2f7a2a', fg: '#ffffff' },
  { k: 'garageSale', lines: ['GARAGE SALE', 'EVERYTHING $1', 'KIDS NOT INCL.'], bg: '#ff7a1a', fg: '#111111' },
  { k: 'estate', lines: ['ESTATE SALE', "DAD'S 4 BOATS"], bg: '#ffffff', fg: '#0b4f8a' },
  { k: 'oils', lines: ['ESSENTIAL', 'OILS SOLD', 'HERE'], bg: '#c9a6e8', fg: '#3a1a5a' },
  { k: 'mlm', lines: ['ASK ME', 'ABOUT MY', 'DOWNLINE'], bg: '#ff4fa0', fg: '#ffffff' },
  { k: 'crypto', lines: ['SLOPCOIN', 'ACCEPTED', 'HERE'], bg: '#111111', fg: '#f7d117' },
  { k: 'blessed', lines: ['BLESSED &', 'STRESSED'], bg: '#f4efe4', fg: '#6b4a2b' },
  { k: 'solarNo', lines: ['SOLAR QUOTE?', 'NO.'], bg: '#ffffff', fg: '#111111' },
  { k: 'dog', lines: ['BEWARE OF DOG', "(HE'S A CHIHUAHUA)"], bg: '#b3151d', fg: '#ffffff' },
  { k: 'mortgage', lines: ['GOD BLESS', 'THIS', 'MORTGAGE'], bg: '#f4efe4', fg: '#2a2a6a' },
  { k: 'influencer', lines: ['HOME OF A', 'FUTURE', 'INFLUENCER'], bg: '#ffd1e8', fg: '#8a1a5a' },
  { k: 'kevin', lines: ['NO TRESPASSING', 'THIS MEANS YOU', 'KEVIN'], bg: '#ffe600', fg: '#111111' },
  { k: 'hoaFine', lines: ['HOA FINE', 'PAID IN FULL', '(UNDER PROTEST)'], bg: '#ffffff', fg: '#5a5a5a' },
  { k: 'eggs', lines: ['FARM FRESH', 'EGGS $12'], bg: '#fff4d6', fg: '#8a4a10' },
  { k: 'lawnPaint', lines: ['LAWN BY', 'SPRAY PAINT', 'CO.'], bg: '#2f9a3a', fg: '#ffffff' },
  { k: 'phase', lines: ["IT'S NOT", 'A PHASE', 'MOM'], bg: '#111111', fg: '#ff4f4f' },
  { k: 'cash4cars', lines: ['JUNK CARS', 'CA$H TODAY'], bg: '#ffe600', fg: '#111111' },
  { k: 'guitar', lines: ['GUITAR LESSONS', 'ASK ABOUT', 'WONDERWALL'], bg: '#ffffff', fg: '#1d1d1f' },
  { k: 'lawyer', lines: ['HURT?', 'CALL BUBBA', '1-800-SUE-ANY1'], bg: '#111111', fg: '#f7d117' },
  { k: 'lose30', lines: ['LOSE 30 LBS', 'ASK ME HOW', '(MLM)'], bg: '#9ee34a', fg: '#111111' },
  { k: 'freeCouch', lines: ['FREE', 'COUCH', '(HAUNTED)'], bg: '#ffffff', fg: '#1d1d1f' },
  { k: 'prepared', lines: ['PREPARED.', 'ARE YOU?'], bg: '#3a4a2a', fg: '#f2e8c8' },
];

/** Vinyl banners with grommets, zip-tied to storefronts, fences and dealerships. */
export const BANNER: { k: string; text: string; sub?: string; bg: string; fg: string }[] = [
  { k: 'grandOpening', text: 'GRAND OPENING', sub: '(AGAIN)', bg: '#d0101a', fg: '#ffe600' },
  { k: 'liquidation', text: 'LIQUIDATION SALE', sub: 'EVERYTHING MUST GO · INCLUDING US', bg: '#ffe600', fg: '#d0101a' },
  { k: 'closing', text: 'STORE CLOSING', sub: 'FOREVER* · *SINCE 2019', bg: '#d0101a', fg: '#ffffff' },
  { k: 'hiring', text: 'NOW HIRING', sub: '$7.25 + EXPOSURE', bg: '#ffffff', fg: '#0b4f8a' },
  { k: 'newMgmt', text: 'UNDER NEW MANAGEMENT', sub: 'SAME OLD SMELL', bg: '#0b4f8a', fg: '#ffffff' },
  { k: 'troops', text: 'WE ♥ OUR TROOPS', sub: 'NO DISCOUNT THO', bg: '#1d3a8a', fg: '#ffffff' },
  { k: 'apr', text: '0% APR*', sub: '*APR IS 29.99%', bg: '#d0101a', fg: '#ffffff' },
  { k: 'noCredit', text: 'NO CREDIT? NO PROBLEM!', sub: 'NO REFUNDS EITHER', bg: '#ffe600', fg: '#111111' },
  { k: 'gold', text: 'CA$H FOR GOLD', sub: 'TEETH · WATCHES · SOULS', bg: '#111111', fg: '#f7d117' },
  { k: 'buyHere', text: 'BUY HERE PAY FOREVER', bg: '#1a7a2a', fg: '#ffffff' },
  { k: 'driveThru', text: 'DRIVE-THRU ONLY', sub: 'DINING ROOM IS HAUNTED', bg: '#ffffff', fg: '#d0101a' },
  { k: 'space', text: 'SPACE AVAILABLE', sub: 'CALL CHAD · 555-0142', bg: '#ffffff', fg: '#1d1d1f' },
  { k: 'happyHour', text: 'HAPPY HOUR', sub: '7 AM – 7 AM', bg: '#ff7a1a', fg: '#111111' },
  { k: 'fireworks', text: 'FIREWORKS', sub: 'BUY 1 GET 1 · LOSE 2 FINGERS', bg: '#d0101a', fg: '#ffe600' },
  { k: 'mattress', text: 'COMING SOON', sub: 'ANOTHER MATTRESS STORE', bg: '#0b4f8a', fg: '#ffffff' },
  { k: 'franchise', text: 'SUPPORT LOCAL', sub: "(WE'RE A FRANCHISE)", bg: '#2a6f3a', fg: '#ffffff' },
  { k: 'sale', text: 'SALE SALE SALE', sub: 'PRICES UP 40% FIRST', bg: '#ffe600', fg: '#d0101a' },
  { k: 'biggest', text: 'BIGGEST SALE OF THE YEAR', sub: 'THIS WEEK · AND NEXT', bg: '#d0101a', fg: '#ffffff' },
  { k: 'gas666', text: 'GAS $6.66', sub: 'PRAY AT PUMP 4', bg: '#111111', fg: '#ff4f1a' },
  { k: 'buffet', text: 'ALL YOU CAN EAT', sub: 'ALL YOU CAN REGRET', bg: '#ff7a1a', fg: '#ffffff' },
  { k: 'wifi', text: 'FREE WI-FI', sub: 'PASSWORD: FREEDOM1776', bg: '#1d3a8a', fg: '#ffffff' },
  { k: 'rto', text: 'RETURN TO OFFICE', sub: 'MANDATORY · VIBES OPTIONAL', bg: '#1d1d1f', fg: '#ffffff' },
  { k: 'family', text: "WE'RE A FAMILY", sub: 'LAYOFFS FRIDAY', bg: '#0b4f8a', fg: '#ffffff' },
  { k: 'luxury', text: 'LUXURY LIVING', sub: 'STUDIOS FROM $3,400', bg: '#1d1d1f', fg: '#d9c9a8' },
  { k: 'leasing', text: 'NOW LEASING', sub: '1 MONTH FREE* · *ON MARS', bg: '#2a6f3a', fg: '#ffffff' },
  { k: 'noDrug', text: 'NOW HIRING', sub: 'NO DRUG TEST · NO QUESTIONS', bg: '#ffe600', fg: '#111111' },
  { k: 'america', text: 'AMERICA MADE', sub: '(ASSEMBLED ELSEWHERE)', bg: '#b3151d', fg: '#ffffff' },
  { k: 'bbq', text: 'WORLD FAMOUS BBQ', sub: 'FAMOUS IN 2 COUNTIES', bg: '#5a2a10', fg: '#ffd27a' },
  { k: 'wings', text: '1¢ WINGS', sub: 'WITH $80 PURCHASE', bg: '#ff7a1a', fg: '#111111' },
  { k: 'tax', text: 'TAX REFUND ADVANCE', sub: '47% APR · WALK-INS', bg: '#1a7a2a', fg: '#ffffff' },
  { k: 'dealership', text: 'TENT SALE', sub: 'EVERY WEEKEND SINCE 1998', bg: '#1d3a8a', fg: '#ffe600' },
  { k: 'ice', text: 'ICE · BAIT · AMMO', sub: 'ONE STOP', bg: '#ffffff', fg: '#0b4f8a' },
  { k: 'wedding', text: 'WEDDINGS · DIVORCES', sub: 'SAME DAY', bg: '#ff4fa0', fg: '#ffffff' },
  { k: 'crypto', text: 'SLOPCOIN ATM', sub: 'FEES ONLY 19%', bg: '#111111', fg: '#f7d117' },
];

/** Changeable-letter boards: churches, strip malls, VFW halls. */
export const MARQUEE: { k: string; lines: string[] }[] = [
  { k: 'church', lines: ['CH _ _ CH', "WHAT'S MISSING?", 'U R'] },
  { k: 'fishFry', lines: ['FRIDAY FISH FRY', 'SUNDAY SERVICE', 'MONDAY REPENT'] },
  { k: 'prayer', lines: ['PRAYER CHANGES THINGS', 'SO DOES THE HOA'] },
  { k: 'jesusSaves', lines: ['JESUS SAVES', 'YOU PAY', 'FULL PRICE'] },
  { k: 'karaoke', lines: ['KARAOKE TONITE', 'APOLOGIES', 'TOMORROW'] },
  { k: 'bait', lines: ['LIVE BAIT', 'COLD BEER', 'MORTGAGES'] },
  { k: 'bingo', lines: ['BINGO THURS', 'CASH PRIZES', 'NO CHEATING GLADYS'] },
  { k: 'heat', lines: ['THINK IT IS HOT?', 'YOU SHOULD SEE', 'THE ELECTRIC BILL'] },
  { k: 'wifiGod', lines: ['LOST YOUR SIGNAL?', 'TRY PRAYER', 'WI-FI INSIDE'] },
  { k: 'tacos', lines: ['TACO TUESDAY', 'MARGS WEDNESDAY', 'SHAME THURSDAY'] },
  { k: 'vets', lines: ['THANK A VET', 'PANCAKES SAT', 'BRING CASH'] },
  { k: 'guns', lines: ['GUN SHOW SAT', 'BAKE SALE SUN', 'SAME TABLES'] },
];

/** Neon window signs: the only satire that glows at night. */
export const NEON: { k: string; text: string; color: string }[] = [
  { k: 'vape', text: 'VAPE', color: '#39ff7a' },
  { k: 'open24', text: 'OPEN 24/7', color: '#ff3b5c' },
  { k: 'cash4gold', text: 'CASH 4 GOLD', color: '#ffd23f' },
  { k: 'pawn', text: 'PAWN', color: '#3fd0ff' },
  { k: 'lotto', text: 'LOTTO $1.2B', color: '#ffd23f' },
  { k: 'liquor', text: 'LIQUOR', color: '#ff3b5c' },
  { k: 'psychic', text: 'PSYCHIC', color: '#c86bff' },
  { k: 'cbd', text: 'CBD', color: '#39ff7a' },
  { k: 'payday', text: 'PAYDAY LOANS', color: '#3fd0ff' },
  { k: 'bail', text: 'BAIL BONDS', color: '#ff3b5c' },
  { k: 'tattoo', text: 'TATTOO', color: '#ff7ad0' },
  { k: 'atm', text: 'ATM', color: '#3fd0ff' },
  { k: 'beer', text: 'COLD BEER', color: '#ffd23f' },
  { k: 'guns', text: 'GUNS', color: '#ff3b5c' },
  { k: 'kratom', text: 'KRATOM', color: '#39ff7a' },
  { k: 'nails', text: 'NAILS', color: '#ff7ad0' },
];

/** Road signs: work zones, highway sponsors, the county line. */
export const ROAD: { k: string; lines: string[]; kind: 'diamond' | 'rect' | 'green' | 'white' }[] = [
  { k: 'roadWork', lines: ['ROAD WORK', 'AHEAD'], kind: 'diamond' },
  { k: 'hopeSo', lines: ['I SURE HOPE', 'IT DOES'], kind: 'rect' },
  { k: 'pothole', lines: ['POTHOLE', 'EST. 2019'], kind: 'diamond' },
  { k: 'speedTrap', lines: ['SPEED TRAP', 'AHEAD (JK)'], kind: 'white' },
  { k: 'adopt', lines: ['ADOPT-A-HIGHWAY', 'SLOP ENERGY LLC'], kind: 'green' },
  { k: 'nextExit', lines: ['NEXT EXIT', 'MORE OF THIS'], kind: 'green' },
  { k: 'endRoad', lines: ['ROAD', 'ENDS', '(BUDGET)'], kind: 'diamond' },
  { k: 'bumpy', lines: ['BUMP', '(ALL OF IT)'], kind: 'diamond' },
  { k: 'childrenPlay', lines: ['SLOW', 'CHILDREN', 'AT PLAY'], kind: 'diamond' },
  { k: 'noOutlet', lines: ['NO OUTLET', '(EMOTIONALLY)'], kind: 'white' },
  { k: 'detour', lines: ['DETOUR', 'GOOD LUCK'], kind: 'rect' },
  { k: 'fine', lines: ['FINES DOUBLE', 'IN WORK ZONES', '(NO WORKERS)'], kind: 'white' },
];

/** Chalkboard A-frame sidewalk signs. */
export const AFRAME: { k: string; lines: string[] }[] = [
  { k: 'coffee', lines: ['TRY OUR NEW', '$19 LATTE', 'IT HAS FOAM'] },
  { k: 'bathroom', lines: ['CLEAN', 'BATHROOMS*', '*NOT'] },
  { k: 'soup', lines: ['SOUP OF', 'THE DAY:', 'YESTERDAY'] },
  { k: 'beer', lines: ['BEER:', 'CHEAPER THAN', 'THERAPY'] },
  { k: 'wifi', lines: ['WE DONT HAVE', 'WIFI', 'TALK TO EACH OTHER'] },
  { k: 'brunch', lines: ['BOTTOMLESS', 'MIMOSAS', 'BOTTOMLESS DEBT'] },
  { k: 'vibes', lines: ['GOOD VIBES', 'ONLY', '$4 CHARGE'] },
  { k: 'tacos', lines: ['TACOS', 'BECAUSE', 'FEELINGS'] },
];

/** Painted decals: notices, stencils, labels. */
export const DECAL = ['hoaNotice', 'minerStencil', 'happyStack', 'daysSince', 'toxic', 'safetyThird', 'nothingToSee', 'packages', 'slopFeed', 'dinoWorld', 'chickenHut', 'makeSlop', 'luxuryPool', 'ceoParking', 'innovation', 'pickItUp'] as const;

const SAT = { sheet: 'sat' as const };

function blank(c: Ctx, w: number, h: number) { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); }

function paintYard(c: Ctx, w: number, h: number, L: Layer, y: (typeof YARD)[number]) {
  if (L === 'e') return blank(c, w, h);
  c.fillStyle = y.bg;
  c.fillRect(0, 0, w, h);
  // corrugated flutes
  c.fillStyle = shade(y.bg, -0.08);
  for (let x = 0; x < w; x += 8) c.fillRect(x, 0, 2, h);
  c.strokeStyle = shade(y.bg, -0.35);
  c.lineWidth = 6;
  c.strokeRect(5, 5, w - 10, h - 10);
  linesFit(c, y.lines, 16, 14, w - 32, h - 28, { family: F.block, color: y.fg, gap: 0.12 });
}

function paintBanner(c: Ctx, w: number, h: number, L: Layer, b: (typeof BANNER)[number]) {
  if (L === 'e') return blank(c, w, h);
  c.fillStyle = b.bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = shade(b.bg, -0.25);
  c.fillRect(0, 0, w, 6);
  c.fillRect(0, h - 6, w, 6);
  // grommets
  c.fillStyle = '#c9c9c9';
  for (const gx of [14, w / 2, w - 14]) for (const gy of [12, h - 12]) circle(c, gx, gy, 5), c.fill();
  if (b.sub) {
    textFit(c, b.text, 28, h * 0.1, w - 56, h * 0.52, { family: F.sign, color: b.fg });
    textFit(c, b.sub, 28, h * 0.62, w - 56, h * 0.26, { family: F.sans, weight: 900, color: b.fg });
  } else textFit(c, b.text, 28, h * 0.14, w - 56, h * 0.72, { family: F.sign, color: b.fg });
}

function paintMarquee(c: Ctx, w: number, h: number, L: Layer, m: (typeof MARQUEE)[number]) {
  if (L === 'e') { blank(c, w, h); c.fillStyle = '#403a30'; c.fillRect(10, 10, w - 20, h - 20); return; }
  c.fillStyle = '#1d1d1f';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#f6f3ea';
  c.fillRect(10, 10, w - 20, h - 20);
  c.fillStyle = '#d8d2c0';
  const rows = m.lines.length;
  for (let r = 1; r < rows; r++) c.fillRect(10, 10 + ((h - 20) * r) / rows - 1, w - 20, 2);
  linesFit(c, m.lines, 22, 16, w - 44, h - 32, { family: F.block, color: '#111111', gap: 0.16 });
}

function paintNeon(c: Ctx, w: number, h: number, L: Layer, n: (typeof NEON)[number]) {
  if (L === 'a') {
    c.fillStyle = '#0e0e12';
    c.fillRect(0, 0, w, h);
    textFit(c, n.text, 14, h * 0.16, w - 28, h * 0.68, { family: F.script, color: shade(n.color, -0.25) });
    return;
  }
  blank(c, w, h);
  textFit(c, n.text, 14, h * 0.16, w - 28, h * 0.68, { family: F.script, color: n.color, shadow: n.color, shadowBlur: 10 });
}

function paintRoad(c: Ctx, w: number, h: number, L: Layer, r: (typeof ROAD)[number]) {
  if (L === 'e') return blank(c, w, h);
  c.fillStyle = 'rgba(0,0,0,0)';
  c.clearRect(0, 0, w, h);
  const bg = r.kind === 'diamond' ? '#ff8a1a' : r.kind === 'rect' ? '#ff8a1a' : r.kind === 'green' ? '#136b3a' : '#ffffff';
  const fg = r.kind === 'green' ? '#ffffff' : '#111111';
  c.fillStyle = bg;
  if (r.kind === 'diamond') {
    c.fillStyle = '#6a6a6a';
    c.fillRect(0, 0, w, h);
    c.beginPath(); c.moveTo(w / 2, 4); c.lineTo(w - 4, h / 2); c.lineTo(w / 2, h - 4); c.lineTo(4, h / 2); c.closePath();
    fillStroke(c, bg, '#111111', 5);
    linesFit(c, r.lines, w * 0.24, h * 0.3, w * 0.52, h * 0.4, { family: F.sans, weight: 900, color: fg, gap: 0.1 });
    return;
  }
  c.fillRect(0, 0, w, h);
  c.strokeStyle = fg;
  c.lineWidth = 6;
  rr(c, 8, 8, w - 16, h - 16, 12);
  c.stroke();
  linesFit(c, r.lines, 22, 20, w - 44, h - 40, { family: F.sans, weight: 900, color: fg, gap: 0.12 });
}

function paintAFrame(c: Ctx, w: number, h: number, L: Layer, a: (typeof AFRAME)[number]) {
  if (L === 'e') return blank(c, w, h);
  c.fillStyle = '#6b4a2b';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#26302a';
  c.fillRect(10, 10, w - 20, h - 20);
  linesFit(c, a.lines, 20, 22, w - 40, h - 44, { family: F.marker, color: '#f2efe4', gap: 0.18 });
}

function paintDecal(c: Ctx, w: number, h: number, L: Layer, k: (typeof DECAL)[number]) {
  if (L === 'e') {
    blank(c, w, h);
    if (k === 'toxic') { c.fillStyle = '#39ff7a'; c.fillRect(w * 0.1, h * 0.55, w * 0.8, h * 0.35); }
    return;
  }
  const lines = (arr: string[], bg: string, fg: string, fam: string = F.block) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    linesFit(c, arr, 16, 14, w - 32, h - 28, { family: fam, color: fg, gap: 0.12 });
  };
  switch (k) {
    case 'hoaNotice': lines(['NOTICE OF VIOLATION', 'GRASS 0.25" TOO TALL', 'FINE: $500 / DAY'], '#ff8a1a', '#111111', F.sans); break;
    case 'minerStencil': lines(['SLOPCOIN', 'MINING CO.', 'DO NOT UNPLUG'], '#3a4a2a', '#f7d117', F.sign); break;
    case 'happyStack': {
      c.fillStyle = '#8a8f96'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f7d117'; circle(c, w / 2, h / 2, h * 0.36); c.fill();
      c.fillStyle = '#111'; circle(c, w / 2 - h * 0.12, h * 0.42, h * 0.05); c.fill(); circle(c, w / 2 + h * 0.12, h * 0.42, h * 0.05); c.fill();
      c.lineWidth = h * 0.05; c.strokeStyle = '#111'; c.beginPath(); c.arc(w / 2, h * 0.5, h * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      break;
    }
    case 'daysSince': {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#1a7a2a'; c.fillRect(0, 0, w, h * 0.26);
      textFit(c, 'THIS PLANT HAS WORKED', 12, 6, w - 24, h * 0.16, { family: F.sans, weight: 900, color: '#fff' });
      textFit(c, '0', w * 0.35, h * 0.3, w * 0.3, h * 0.44, { family: F.block, color: '#d0101a' });
      textFit(c, 'DAYS WITHOUT AN INCIDENT', 12, h * 0.78, w - 24, h * 0.16, { family: F.sans, weight: 900, color: '#111' });
      break;
    }
    case 'toxic': lines(['TOTALLY', 'NOT TOXIC'], '#f7d117', '#111111', F.sign); break;
    case 'safetyThird': lines(['SAFETY', 'THIRD'], '#d0101a', '#ffffff', F.sign); break;
    case 'nothingToSee': lines(['NOTHING TO SEE', 'HERE'], '#1d1d1f', '#f2efe4', F.sans); break;
    case 'packages': {
      c.fillStyle = '#c69a5e'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a2a2a'; for (let i = 0; i < 3; i++) c.fillRect(0, h * (0.3 + i * 0.22), w, 3);
      textFit(c, 'SLOP PRIME', w * 0.15, h * 0.05, w * 0.7, h * 0.22, { family: F.sans, weight: 900, color: '#1d3a8a' });
      break;
    }
    case 'slopFeed': lines(['SLOP', 'FEED & SEED'], '#b3151d', '#ffffff', F.sign); break;
    case 'dinoWorld': lines(['DINO WORLD', 'FREE PARKING'], '#2a6f3a', '#f7d117', F.round); break;
    case 'chickenHut': lines(['CHICKEN HUT', 'EST. LAST YEAR'], '#ffe600', '#d0101a', F.round); break;
    case 'makeSlop': lines(['MAKE SLOP', 'GREAT AGAIN'], '#c01818', '#ffffff', F.block); break;
    case 'luxuryPool': lines(['AMENITY', 'POOL', '(4 FT²)'], '#3fb0e8', '#ffffff', F.sign); break;
    case 'ceoParking': lines(['RESERVED', 'CEO PARKING', 'SPOTS 1-12'], '#ffffff', '#1d3a8a', F.sans); break;
    case 'innovation': lines(['INNOVATION', 'HUB™'], '#1d1d1f', '#3fd0ff', F.sans); break;
    case 'pickItUp': lines(['PICK IT UP', 'KAREN'], '#2a6f3a', '#ffffff', F.sans); break;
  }
}

export function registerSatireArt() {
  for (const y of YARD) defTile('sat:yard:' + y.k, 256, 160, (c, w, h, L) => paintYard(c, w, h, L, y), { ...SAT, res: 0.5 });
  for (const b of BANNER) defTile('sat:banner:' + b.k, 512, 112, (c, w, h, L) => paintBanner(c, w, h, L, b), { ...SAT, res: 0.5 });
  for (const m of MARQUEE) defTile('sat:marquee:' + m.k, 512, 200, (c, w, h, L) => paintMarquee(c, w, h, L, m), { ...SAT, res: 0.5 });
  for (const n of NEON) defTile('sat:neon:' + n.k, 256, 96, (c, w, h, L) => paintNeon(c, w, h, L, n), { ...SAT, res: 0.6, emissive: true });
  for (const r of ROAD) defTile('sat:road:' + r.k, 256, 200, (c, w, h, L) => paintRoad(c, w, h, L, r), { ...SAT, res: 0.5 });
  for (const a of AFRAME) defTile('sat:aframe:' + a.k, 176, 240, (c, w, h, L) => paintAFrame(c, w, h, L, a), { ...SAT, res: 0.5 });
  for (const k of DECAL) defTile('sat:decal:' + k, 256, 192, (c, w, h, L) => paintDecal(c, w, h, L, k), { ...SAT, res: 0.5 });
  // flags: the stars and stripes, the "don't tread on my lawn", the county, the sports team
  defTile('sat:flag:lawn', 256, 160, (c, w, h, L) => {
    if (L === 'e') return blank(c, w, h);
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, w, h);
    textFit(c, "DON'T TREAD", 16, h * 0.08, w - 32, h * 0.26, { family: F.block, color: '#111' });
    textFit(c, 'ON MY LAWN', 16, h * 0.66, w - 32, h * 0.26, { family: F.block, color: '#111' });
    c.fillStyle = '#2f7a2a'; c.fillRect(w * 0.3, h * 0.4, w * 0.4, h * 0.2);
  }, { ...SAT, res: 0.5 });
  defTile('sat:flag:team', 256, 160, (c, w, h, L) => {
    if (L === 'e') return blank(c, w, h);
    stripes(c, 0, 0, w, h, ['#ff7a1a', '#1d3a8a'], 2, true);
    textFit(c, 'GO SLOPS', 16, h * 0.3, w - 32, h * 0.4, { family: F.sign, color: '#ffffff' });
  }, { ...SAT, res: 0.5 });
  defTile('sat:flag:boat', 256, 160, (c, w, h, L) => {
    if (L === 'e') return blank(c, w, h);
    c.fillStyle = '#0b4f8a'; c.fillRect(0, 0, w, h);
    textFit(c, 'BOAT PARADE', 16, h * 0.14, w - 32, h * 0.3, { family: F.sign, color: '#ffffff' });
    textFit(c, 'SEASON PASS', 16, h * 0.56, w - 32, h * 0.26, { family: F.sans, weight: 900, color: '#ffe600' });
  }, { ...SAT, res: 0.5 });
}

/** every satire tile name, for tests and the catalog count */
export function satireTileNames(): string[] {
  return [
    ...YARD.map((y) => 'sat:yard:' + y.k), ...BANNER.map((b) => 'sat:banner:' + b.k), ...MARQUEE.map((m) => 'sat:marquee:' + m.k),
    ...NEON.map((n) => 'sat:neon:' + n.k), ...ROAD.map((r) => 'sat:road:' + r.k), ...AFRAME.map((a) => 'sat:aframe:' + a.k),
    ...DECAL.map((k) => 'sat:decal:' + k), 'sat:flag:lawn', 'sat:flag:team', 'sat:flag:boat',
  ];
}
