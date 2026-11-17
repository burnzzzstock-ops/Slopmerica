// A small, fast compressor for save files, and a way to keep its bytes in a JavaScript string.
//
// A city's save is a few megabytes of JSON. Browser storage (localStorage) counts characters and stops at about five million,
// and it has to be written in one synchronous call when the page is going away, so the compressor must be quick and need no
// worker, no stream and no library. This is the LZ4 block idea: runs of literal bytes and back-references to bytes seen up to
// 64 KiB earlier, found with a hash of the next four bytes. On save JSON it gets 2.5 to 4 times smaller at a few hundred
// megabytes a second, and unpacking is faster still.
//
// packString / unpackString turn text into a string of ordinary characters holding 15 bits each (no surrogates, no control
// characters), so 1 character of storage carries almost 2 bytes of compressed data.
//
// Plain data-in, data-out TypeScript with only erasable types: Node's test runner loads it as it is.

const HASH_BITS = 16;
const MIN_MATCH = 4;

/** Compress bytes. The result begins with the original length (4 bytes, little-endian). */
export function compress(src: Uint8Array): Uint8Array {
  const n = src.length;
  // worst case: every byte a literal, plus a length byte per 255 literals, the header and a token
  const out = new Uint8Array(n + Math.ceil(n / 255) + 16);
  out[0] = n & 255; out[1] = (n >>> 8) & 255; out[2] = (n >>> 16) & 255; out[3] = (n >>> 24) & 255;
  let o = 4;
  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  let anchor = 0, i = 0;
  const end = n - MIN_MATCH;
  const emit = (litEnd: number, matchLen: number, offset: number) => {
    const lit = litEnd - anchor;
    const tokenAt = o++;
    let token = (lit < 15 ? lit : 15) << 4;
    if (lit >= 15) { let r = lit - 15; while (r >= 255) { out[o++] = 255; r -= 255; } out[o++] = r; }
    out.set(src.subarray(anchor, litEnd), o);
    o += lit;
    if (matchLen) {
      out[o++] = offset & 255; out[o++] = offset >>> 8;
      const m = matchLen - MIN_MATCH;
      token |= m < 15 ? m : 15;
      if (m >= 15) { let r = m - 15; while (r >= 255) { out[o++] = 255; r -= 255; } out[o++] = r; }
    }
    out[tokenAt] = token;
  };
  while (i <= end) {
    const seq = src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24);
    const h = (Math.imul(seq, 2654435761) >>> (32 - HASH_BITS));
    const ref = table[h];
    table[h] = i;
    if (ref >= 0 && i - ref < 65536 && src[ref] === src[i] && src[ref + 1] === src[i + 1] && src[ref + 2] === src[i + 2] && src[ref + 3] === src[i + 3]) {
      let len = MIN_MATCH;
      while (i + len < n && src[ref + len] === src[i + len]) len++;
      emit(i, len, i - ref);
      i += len;
      anchor = i;
    } else i++;
  }
  emit(n, 0, 0);
  return out.subarray(0, o);
}

/** The bytes compress() was given. Throws on data that is not its output. */
export function decompress(src: Uint8Array): Uint8Array {
  if (src.length < 4) throw new Error('lz: too short');
  const n = (src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24)) >>> 0;
  const out = new Uint8Array(n);
  let i = 4, o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >>> 4;
    if (lit === 15) { let b: number; do { b = src[i++]; lit += b; } while (b === 255); }
    if (o + lit > n || i + lit > src.length) throw new Error('lz: damaged data');
    out.set(src.subarray(i, i + lit), o);
    i += lit; o += lit;
    if (i >= src.length) break;   // the last piece is literals only
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = (token & 15) + MIN_MATCH;
    if ((token & 15) === 15) { let b: number; do { b = src[i++]; len += b; } while (b === 255); }
    if (offset === 0 || offset > o || o + len > n) throw new Error('lz: damaged data');
    // (byte by byte: a match may overlap what it is writing, which is how a run repeats)
    for (let k = 0, from = o - offset; k < len; k++) out[o++] = out[from + k];
  }
  if (o !== n) throw new Error('lz: damaged data');
  return out;
}

/** Bytes as a string of ordinary characters, 15 bits each (code points 0x20..0x801F). The first character holds how many bytes the last characters carry. */
export function bytesToText(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [], acc = 0, bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      chunk.push(0x20 + ((acc >>> bits) & 0x7fff));
      acc &= (1 << bits) - 1;
      if (chunk.length >= 8192) { parts.push(String.fromCharCode(...chunk)); chunk = []; }
    }
  }
  if (bits > 0) chunk.push(0x20 + ((acc << (15 - bits)) & 0x7fff));
  parts.push(String.fromCharCode(...chunk));
  // the length rides along: the padding in the last character is not data
  return `${bytes.length.toString(36)}:${parts.join('')}`;
}

export function textToBytes(text: string): Uint8Array {
  const colon = text.indexOf(':');
  const n = colon > 0 ? parseInt(text.slice(0, colon), 36) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new Error('lz: not packed text');
  const out = new Uint8Array(n);
  let acc = 0, bits = 0, o = 0;
  for (let i = colon + 1; i < text.length && o < n; i++) {
    const v = text.charCodeAt(i) - 0x20;
    if (v < 0 || v > 0x7fff) throw new Error('lz: damaged text');
    acc = (acc << 15) | v;
    bits += 15;
    while (bits >= 8 && o < n) { bits -= 8; out[o++] = (acc >>> bits) & 255; }
    acc &= (1 << bits) - 1;
  }
  if (o !== n) throw new Error('lz: damaged text');
  return out;
}

/** What a packed save begins with (a plain save begins with "{"). */
export const PACKED = 'SLZ1:';

/** Text, compressed, as storable characters. */
export function packString(text: string): string {
  return PACKED + bytesToText(compress(new TextEncoder().encode(text)));
}

/** The text packString() was given; text that was never packed comes back as it is. */
export function unpackString(stored: string): string {
  if (!stored.startsWith(PACKED)) return stored;
  return new TextDecoder().decode(decompress(textToBytes(stored.slice(PACKED.length))));
}
