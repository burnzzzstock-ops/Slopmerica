// Where the committed fixtures are, whatever folder a script is run from, and how to read them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const at = (rel) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
/**
 * REFTOWN=v1 opens the reference town as it was before it got its main street and utilities (262 buildings, no power or water).
 * Look numbers, budgets and thresholds recorded on that town keep meaning something with it; a test whose registry entry sets
 * it is waiting to be measured again on today's town. Nothing new should use it.
 */
export const OLD_TOWN = process.env.REFTOWN === 'v1';
/** The reference block: a save of the town every look and traffic test opens (scripts/refblock.mjs), gzipped. */
export const REFBLOCK = at(OLD_TOWN ? 'refblock-town.json' : 'refblock-town.json.gz');
/** Its centre, { x, z }: cameras and rigs are placed from it. */
export const REFBLOCK_CENTER = at(OLD_TOWN ? 'refblock-town.v1.center.json' : 'refblock-town.center.json');
/** A file under scripts/fixtures. */
export const fixture = at;

/** A save fixture's text (a .json.gz is unzipped; a .json is read as it is). */
export function readSave(path) {
  const buf = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}
/** Write a save's text as a fixture (gzipped when the name ends in .gz). */
export function writeSave(path, text) {
  writeFileSync(path, path.endsWith('.gz') ? gzipSync(Buffer.from(text, 'utf8'), { level: 9 }) : text);
}
/** The reference block's save as text. */
export const refblockText = () => readSave(REFBLOCK);
export const hasRefblock = () => existsSync(REFBLOCK);
