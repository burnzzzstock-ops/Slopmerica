// Fetch a packed asset set: <base>pack.json plus its geometry, either raw
// (pack.bin) or as base64 text named by the JSON's bin64. Checks the byte
// count. The single-file build carries each pack inside the page instead
// (vite.config.ts, gamePacks): opened from disk it can fetch nothing beside
// it, so the embedded copy is used first.

/** base64 text to bytes */
export function unbase64(text: string): ArrayBuffer {
  const s = atob(text.trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** The pack the page carries for `base` (its last folder names it: civic/ -> #slop-pack-civic), or null. */
function embedded<J>(base: URL): { json: J; bin: ArrayBuffer } | null {
  if (typeof document === 'undefined') return null;
  const name = base.pathname.split('/').filter(Boolean).pop();
  const json = name && document.getElementById(`slop-pack-${name}`), bin = name && document.getElementById(`slop-pack-${name}-bin`);
  if (!json || !bin) return null;
  return { json: JSON.parse(json.textContent ?? '') as J, bin: unbase64(bin.textContent ?? '') };
}

export async function fetchPack<J extends { bytes: number; bin64?: string }>(base: URL): Promise<{ json: J; bin: ArrayBuffer }> {
  const own = embedded<J>(base);
  const get = async (name: string) => { const r = await fetch(new URL(name, base)); if (!r.ok) throw new Error(`${name} ${r.status}`); return r; };
  const json = own ? own.json : ((await (await get('pack.json')).json()) as J);
  const bin = own ? own.bin : json.bin64 ? unbase64(await (await get(json.bin64)).text()) : await (await get('pack.bin')).arrayBuffer();
  if (bin.byteLength !== json.bytes) throw new Error(`pack geometry is ${bin.byteLength} bytes, expected ${json.bytes}`);
  return { json, bin };
}
