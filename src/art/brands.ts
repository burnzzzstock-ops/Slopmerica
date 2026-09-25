// Brands of Slopmerica. Slop and friends are real Imagine Supply Co. product
// lines (merch: true) and get extra weight when stores spawn. Everything else
// is parody. Each brand drives its store archetype (kind), sign colors and font.
import type { ZoneType } from '../contracts';

export const MERCH_URL = 'https://imaginesupply.co/';

export type BrandKind =
  | 'gas' | 'food' | 'apparel' | 'bar' | 'smoke' | 'propane' | 'resort' | 'tech' | 'retail'
  | 'drink' | 'bank' | 'auto' | 'church' | 'industry' | 'office' | 'grocery' | 'storage' | 'fitness' | 'coffee';

export type SignFont = 'Bungee' | 'Anton' | 'Titan One' | 'Permanent Marker' | 'Yellowtail' | 'Overpass';

export interface Brand {
  id: string;
  name: string;
  kind: BrandKind;
  zones: ZoneType[]; // where it can spawn
  colors: [string, string]; // sign background, lettering
  font?: SignFont;
  merch?: boolean; // real Imagine Supply Co. / Slop product line
  blurb?: string;
}

export const BRANDS: Brand[] = [
  // ---- the real merch lines (imaginesupply.co)
  { id: 'slop', name: 'Slop', kind: 'apparel', zones: ['comLow', 'comHigh'], colors: ['#111111', '#efe6cf'], font: 'Yellowtail', merch: true, blurb: 'Slop Script. The official fit of Slopmerica.' },
  { id: 'slopDrink', name: 'SLOP', kind: 'drink', zones: ['comLow', 'industry'], colors: ['#c6f432', '#111111'], font: 'Bungee', merch: true, blurb: 'Slop, the drink. Tastes like a Tuesday.' },
  { id: 'fillErUp', name: 'Fill Er Up', kind: 'gas', zones: ['comLow'], colors: ['#b3202a', '#ffffff'], font: 'Titan One', merch: true, blurb: 'Gas, jerky, destiny.' },
  { id: 'myOwnPropane', name: 'My Own Propane', kind: 'propane', zones: ['comLow', 'industry'], colors: ['#1d4fa3', '#ffffff'], font: 'Anton', merch: true },
  { id: 'propaneParadise', name: 'Propane Paradise', kind: 'propane', zones: ['comLow'], colors: ['#f5a623', '#1d2a5a'], font: 'Titan One', merch: true },
  { id: 'neuralFly', name: 'Neural Fly', kind: 'tech', zones: ['office', 'comHigh'], colors: ['#0b0f1a', '#6ef0ff'], font: 'Bungee', merch: true, blurb: 'AI for flies. Flies for AI.' },
  { id: 'badLuckClub', name: 'Bad Luck Club', kind: 'bar', zones: ['comLow', 'comHigh'], colors: ['#151515', '#e8c547'], font: 'Permanent Marker', merch: true },
  { id: 'cabinetAfterHours', name: 'Cabinet After Hours', kind: 'bar', zones: ['comLow', 'comHigh'], colors: ['#3a1440', '#ff7bd5'], font: 'Yellowtail', merch: true },
  { id: 'smokeSignal', name: 'Smoke Signal', kind: 'smoke', zones: ['comLow'], colors: ['#2b2b2b', '#ff8a2a'], font: 'Bungee', merch: true },
  { id: 'smokeshow', name: 'Smokeshow', kind: 'smoke', zones: ['comLow', 'comHigh'], colors: ['#ff4fa3', '#ffffff'], font: 'Titan One', merch: true },
  { id: 'pigCabana', name: 'Pig Cabana', kind: 'resort', zones: ['comHigh'], colors: ['#ff9ec4', '#6a1b3a'], font: 'Titan One', merch: true },
  { id: 'slop69', name: 'Slop 69', kind: 'apparel', zones: ['comLow', 'comHigh'], colors: ['#efe6cf', '#111111'], font: 'Anton', merch: true },
  { id: 'cannonBoys', name: 'Cannon Boys', kind: 'food', zones: ['comLow'], colors: ['#7a3b1c', '#ffd8a8'], font: 'Bungee', merch: true, blurb: 'Pig-forward cuisine from Wigette & the Cannon Boys.' },
  // ---- parody everything else
  { id: 'dollarColonel', name: 'Dollar Colonel', kind: 'retail', zones: ['comLow'], colors: ['#ffd400', '#111111'], font: 'Anton' },
  { id: 'waffleBunker', name: 'Waffle Bunker', kind: 'food', zones: ['comLow'], colors: ['#ffd400', '#111111'], font: 'Anton' },
  { id: 'buckEez', name: "Buck-Eez", kind: 'gas', zones: ['comLow'], colors: ['#d8252b', '#ffd400'], font: 'Titan One' },
  { id: 'sheetzHappens', name: 'Sheetz Happens', kind: 'gas', zones: ['comLow'], colors: ['#c8102e', '#ffffff'], font: 'Bungee' },
  { id: 'waawaa', name: 'WaaWaa', kind: 'gas', zones: ['comLow'], colors: ['#b3202a', '#f5e050'], font: 'Titan One' },
  { id: 'crackedBarrel', name: 'Cracked Barrel', kind: 'food', zones: ['comLow'], colors: ['#5a3a1a', '#f5d58a'], font: 'Permanent Marker' },
  { id: 'chickFilAhh', name: 'Chick-Fil-Ahh', kind: 'food', zones: ['comLow'], colors: ['#e51636', '#ffffff'], font: 'Yellowtail' },
  { id: 'burgerDuke', name: 'Burger Duke', kind: 'food', zones: ['comLow'], colors: ['#f2a900', '#c8102e'], font: 'Titan One' },
  { id: 'mallWart', name: 'Mall-Wart', kind: 'grocery', zones: ['comLow', 'comHigh'], colors: ['#0071ce', '#ffc220'], font: 'Anton' },
  { id: 'wholePaycheck', name: 'Whole Paycheck', kind: 'grocery', zones: ['comLow', 'comHigh'], colors: ['#00674b', '#ffffff'], font: 'Overpass' },
  { id: 'traderJokes', name: "Trader Jokes", kind: 'grocery', zones: ['comLow'], colors: ['#c8102e', '#ffffff'], font: 'Permanent Marker' },
  { id: 'starbux', name: 'Starbux', kind: 'coffee', zones: ['comLow', 'comHigh'], colors: ['#00704a', '#ffffff'], font: 'Bungee' },
  { id: 'dunkinDollars', name: "Dunkin' Dollars", kind: 'coffee', zones: ['comLow'], colors: ['#ff671f', '#e11383'], font: 'Titan One' },
  { id: 'hobbyLobbyist', name: 'Hobby Lobbyist', kind: 'retail', zones: ['comLow', 'comHigh'], colors: ['#f26b21', '#ffffff'], font: 'Overpass' },
  { id: 'planetFatness', name: 'Planet Fatness', kind: 'fitness', zones: ['comLow', 'comHigh'], colors: ['#5c2d91', '#ffd400'], font: 'Titan One' },
  { id: 'vapeNation', name: 'Vape Nation', kind: 'smoke', zones: ['comLow'], colors: ['#111111', '#b36bff'], font: 'Bungee' },
  { id: 'mattressFirmish', name: 'Mattress Firm-ish', kind: 'retail', zones: ['comLow'], colors: ['#d71920', '#ffffff'], font: 'Anton' },
  { id: 'spiritForever', name: 'Spirit Halloween (Permanent)', kind: 'retail', zones: ['comLow'], colors: ['#ff6a00', '#111111'], font: 'Bungee' },
  { id: 'bitcornAtm', name: 'Bitcorn ATM', kind: 'bank', zones: ['comLow', 'comHigh'], colors: ['#f7931a', '#111111'], font: 'Bungee' },
  { id: 'freedomBank', name: 'Freedom Bank & Pawn', kind: 'bank', zones: ['comLow', 'comHigh', 'office'], colors: ['#1d3a8a', '#ffffff'], font: 'Anton' },
  { id: 'cyberslop', name: 'Cyberslop Motors', kind: 'auto', zones: ['comLow', 'comHigh'], colors: ['#d8d8d8', '#111111'], font: 'Bungee' },
  { id: 'truckNutz', name: 'Truck Nutz Outlet', kind: 'auto', zones: ['comLow'], colors: ['#222222', '#c0c0c0'], font: 'Titan One' },
  { id: 'jiffyLubeish', name: 'Jiffy Lube-ish', kind: 'auto', zones: ['comLow'], colors: ['#e4002b', '#ffd400'], font: 'Anton' },
  { id: 'uStoreIt', name: 'U-Store-Ur-Regrets', kind: 'storage', zones: ['comLow', 'industry'], colors: ['#f26522', '#ffffff'], font: 'Anton' },
  { id: 'slopmazon', name: 'Slopmazon', kind: 'industry', zones: ['industry'], colors: ['#232f3e', '#ff9900'], font: 'Overpass' },
  { id: 'frackCo', name: 'FrackCo', kind: 'industry', zones: ['industry'], colors: ['#2a2a2a', '#ffd400'], font: 'Anton' },
  { id: 'coalCo', name: 'Clean Coal Co.', kind: 'industry', zones: ['industry'], colors: ['#111111', '#8fd14f'], font: 'Bungee' },
  { id: 'meatPacking', name: 'Mystery Meats Inc.', kind: 'industry', zones: ['industry'], colors: ['#8b1a1a', '#ffffff'], font: 'Titan One' },
  { id: 'synergyPlex', name: 'SynergyPlex', kind: 'office', zones: ['office'], colors: ['#0b2545', '#8ecae6'], font: 'Overpass' },
  { id: 'disruptly', name: 'Disruptly', kind: 'office', zones: ['office'], colors: ['#ffffff', '#ff3366'], font: 'Bungee' },
  { id: 'hedgeHog', name: 'HedgeHog Capital', kind: 'office', zones: ['office'], colors: ['#111111', '#d4af37'], font: 'Anton' },
  { id: 'consultingLLC', name: 'Consulting LLC LLC', kind: 'office', zones: ['office'], colors: ['#e9ecef', '#1d3557'], font: 'Overpass' },
];

export function brandById(id: string | undefined): Brand | undefined {
  return BRANDS.find((b) => b.id === id);
}

/** Generic signage that isn't a brand (apartment leasing banners etc.). */
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
