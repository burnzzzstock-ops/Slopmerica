// Where the committed fixtures are, whatever folder a script is run from.
import { fileURLToPath } from 'node:url';

const at = (rel) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
/** The reference block: a save of the town every look and traffic test opens (scripts/refblock.mjs). */
export const REFBLOCK = at('refblock-town.json');
/** Its centre, { x, z }: cameras and rigs are placed from it. */
export const REFBLOCK_CENTER = at('refblock-town.center.json');
/** A folder of fixtures. */
export const fixture = at;
