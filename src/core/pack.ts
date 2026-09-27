// Fetch a packed asset set: <base>pack.json plus its geometry, either raw
// (pack.bin) or as base64 text named by the JSON's bin64 (the single-file
// build is published where .bin isn't served). Checks the byte count.

/** base64 text to bytes */
export function unbase64(text: string): ArrayBuffer {
  const s = atob(text.trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export async function fetchPack<J extends { bytes: number; bin64?: string }>(base: URL): Promise<{ json: J; bin: ArrayBuffer }> {
  const get = async (name: string) => { const r = await fetch(new URL(name, base)); if (!r.ok) throw new Error(`${name} ${r.status}`); return r; };
  const json = (await (await get('pack.json')).json()) as J;
  const bin = json.bin64 ? unbase64(await (await get(json.bin64)).text()) : await (await get('pack.bin')).arrayBuffer();
  if (bin.byteLength !== json.bytes) throw new Error(`pack geometry is ${bin.byteLength} bytes, expected ${json.bytes}`);
  return { json, bin };
}
