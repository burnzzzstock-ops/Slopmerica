// Named save slots: cities the player has put away on purpose, as many as they like.
//
// The autosave and its backup live in localStorage, because that can be written in one synchronous call as the page goes away.
// It holds about five million characters, which is one big city and its backup and no more. Slots go in IndexedDB, which has
// room for dozens and is only written when the player asks. Each slot is a save's text (packed when big, as it is stored
// anywhere) with a few facts beside it for the list (city, county, people, day, when).
//
// Nothing here throws at the caller: a browser with IndexedDB blocked (some private modes) gets an empty list and `false`
// from a write, and the screens say so.
import { readSaveText, storable, type SaveData } from './save';
import { unpackString } from '../core/lz';

const DB = 'slopmerica', STORE = 'slots';

export interface SlotInfo {
  /** what the player called it (the key: saving under the same name replaces it, after asking) */
  name: string;
  city: string;
  map: string;
  mode: string;
  pop: number;
  day: number;
  /** when it was put in the slot (ms since 1970) */
  savedAt: number;
  /** characters stored */
  size: number;
}
interface SlotRow extends SlotInfo { text: string }

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(STORE, mode), req = work(tx.objectStore(STORE));
      let out: T | null = null;
      req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  }));
}

/** Every slot, newest first (without the cities themselves). */
export async function listSlots(): Promise<SlotInfo[]> {
  const rows = (await run<SlotRow[]>('readonly', (s) => s.getAll())) ?? [];
  return rows.map(({ text: _text, ...info }) => info).sort((a, b) => b.savedAt - a.savedAt);
}

/** Put a city (a save's text, packed or plain) in a slot. False when it could not be stored or is not a city. */
export async function writeSlot(name: string, saveText: string): Promise<boolean> {
  const r = readSaveText(saveText);
  if (!r.save || !name.trim()) return false;
  const d = r.save, text = storable(unpackString(saveText));
  const row: SlotRow = { name: name.trim().slice(0, 60), city: d.city, map: d.map, mode: d.mode, pop: d.pop, day: Math.floor(d.day), savedAt: Date.now(), size: text.length, text };
  const key = await run<IDBValidKey>('readwrite', (s) => s.put(row));
  return key !== null;
}

/** The city in a slot, brought up to today's save version, or null (no such slot, or it cannot be read). */
export async function readSlot(name: string): Promise<{ save: SaveData; text: string } | null> {
  const row = await run<SlotRow | undefined>('readonly', (s) => s.get(name));
  if (!row) return null;
  const r = readSaveText(row.text);
  return r.save ? { save: r.save, text: row.text } : null;
}

export async function deleteSlot(name: string): Promise<boolean> {
  return (await run<undefined>('readwrite', (s) => s.delete(name))) !== null || !(await listSlots()).some((x) => x.name === name);
}

/** A name for a new slot that no slot has: "Gator Gulch, day 412", then "... (2)". */
export function slotName(city: string, day: number, taken: readonly string[]): string {
  const base = `${city}, day ${Math.floor(day)}`;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} (${i})`)) return `${base} (${i})`;
}
