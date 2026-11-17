// Where the committed fixtures are, whatever folder a script is run from, and how to read them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const at = (rel) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
/** The reference block: a save of the town every look and traffic test opens (scripts/refblock.mjs), gzipped. */
export const REFBLOCK = at('refblock-town.json.gz');
/** Its centre, { x, z }: cameras and rigs are placed from it. */
export const REFBLOCK_CENTER = at('refblock-town.center.json');
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
