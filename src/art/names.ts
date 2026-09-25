// Naming engine data: everything is named after what it replaced, or after
// what it wishes it was. Apartment names are also painted as signs.

export const APT_NAMES = [
  'The Vue @ Creekside',
  'The Reserve at Hemlock Creek',
  'Heron Marsh Flats',
  'The Lofts at Old Oak',
  'Deer Run Residences',
  'The Pinnacle (Phase II)',
  'Aspire @ Whispering Pines',
  'The Edison @ Parkway',
  'Solace on Main',
  'The Meadows (Formerly)',
  'Elevate @ Exit 9',
  'The Artisan District Lofts',
];

export const FLOOR_PLANS = ['The Ashford', 'The Beaumont', 'The Carrington', 'The Davenport', 'The Ellington', 'The Fairhaven'];

export const HOUSE_KIND: Record<number, string[]> = {
  1: ['Single-Wide', 'Holler Cabin', 'Double-Wide', 'Shack w/ Satellite Dish', 'Whispering Pines Mobile Home'],
  2: ['Brick Ranch', 'Split-Level Ranch', 'Starter Ranch', 'Carport Ranch'],
  3: ['Tract Home', 'Tract Home', 'Tract Home'],
  4: ['McMansion', 'Estate Home', 'Garage With A House Attached'],
  5: ['Mega-McMansion', 'Modern Farmhouse', 'Barndominium Estate'],
};

export const MEGABLOCK_NAMES = ['Sprawl Tower Block 7', 'Kowloon Commons', 'Unit Stack 404', 'The Hive @ Exit 12', 'Blackrack Residential Megablock', 'Arcology (Budget)'];

export const RESI_TOWER_NAMES = ['One Parkway Place', 'The Skyline Residences', 'Tower at Sprawl Pointe', 'Vista Heights', 'The Summit Condos'];

export const MIDRISE_NAMES = ['Parkview Commons', 'The Garfield', 'Lakeview (No Lake)', 'Station Square', 'The Monroe'];

export const GARDEN_APT_NAMES = ['Pine Hollow Apartments', 'Creekside Garden Apts', 'Colonial Village', 'Shady Acres', 'Meadowbrook Apartments'];

export const COUNTY_NAMES: Record<string, string> = {
  appalachia: 'HOLLER COUNTY',
  norcal: 'GOLDEN COAST',
  florida: 'GATOR GULCH',
  generic: 'SLOPMERICA',
};

export const SCREEN_ADS = ['slop', 'lightning', 'neural', 'sloptok', 'bitcorn', 'chick', 'wigette', 'news'] as const;
