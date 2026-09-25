// STUB — owned by the Buildings & Brands workstream (replace wholesale).
import type { ZoneType } from '../contracts';

export const MERCH_URL = 'https://imaginesupply.co/';

export type BrandKind =
  | 'gas' | 'food' | 'apparel' | 'bar' | 'smoke' | 'propane' | 'resort' | 'tech' | 'retail'
  | 'drink' | 'bank' | 'auto' | 'church' | 'industry' | 'office' | 'grocery' | 'storage';

export interface Brand {
  id: string;
  name: string;
  kind: BrandKind;
  zones: ZoneType[]; // where it can spawn
  colors: [string, string]; // primary, secondary
  merch?: boolean; // real Imagine Supply Co. / Slop product line
  blurb?: string;
}

export const BRANDS: Brand[] = [
  { id: 'slop', name: 'Slop', kind: 'apparel', zones: ['comLow', 'comHigh'], colors: ['#111111', '#efe6cf'], merch: true, blurb: 'Slop Script. The official fit of Slopmerica.' },
  { id: 'fillErUp', name: 'Fill Er Up', kind: 'gas', zones: ['comLow'], colors: ['#b3202a', '#1d3a8a'], merch: true },
  { id: 'myOwnPropane', name: 'My Own Propane', kind: 'propane', zones: ['comLow', 'industry'], colors: ['#1d4fa3', '#ffffff'], merch: true },
  { id: 'dollarColonel', name: 'Dollar Colonel', kind: 'retail', zones: ['comLow'], colors: ['#ffd400', '#111111'] },
];

export function brandById(id: string | undefined): Brand | undefined {
  return BRANDS.find((b) => b.id === id);
}
