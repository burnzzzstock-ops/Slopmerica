// Commune names (shared by the commune generator and the sign atlas).
import type { MapId } from '../world/maps';

export const COMMUNE_NAMES: Record<MapId | 'any', string[]> = {
  any: [
    'Sunflower Collective', 'Mother Earth Commune', 'The Vibe Zone', 'Camp Kombucha', 'Free Love Acres', 'Crystal Healing Co-op',
    'Harmony Hollow', 'Moonchild Ranch', 'Tofu Ridge', 'Sprout Nation', 'Hemp Haven', 'Granola Gulch', 'Solstice Village',
    'The Drum Circle That Never Ends', 'Woodstock Forever', 'Birkenstock Bluffs', 'Vegan Vortex', 'Cosmic Yurt Collective',
    'Mushroom Meadow', 'Patchouli Pines', 'Third Eye Estates', 'Dandelion Nation',
  ],
  appalachia: ['Dreadlock Holler', 'Moonshine & Mantras', 'Banjo Buddha Farm', 'Ramp Festival Forever'],
  norcal: ['Big Sur-render', 'Redwood Rainbow Tribe', 'Humboldt Harmony', 'Esalen-ish Institute', 'Burning Mini'],
  florida: ['Swamp Shaman Co-op', 'Gator Gaia', 'Manatee Mindfulness', 'Everglade Energy Healing'],
};

export const ALL_COMMUNE_NAMES = [...new Set(Object.values(COMMUNE_NAMES).flat())];
