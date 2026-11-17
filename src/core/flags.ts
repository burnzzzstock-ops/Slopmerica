// Who the page is for: a player, a developer, or a playtester. A shipped
// build must not hand every player the debug hooks or the developer
// furniture, but the tests and the owner's phone still need them, so the
// decision is made once, here, when the page loads.
//
//   DEBUG     the window.__game / __dbg / __services ... hooks the browser tests drive the game through.
//             On under the dev server, with #debug or #playtest anywhere in the address, or when
//             localStorage 'slopmerica.debug' is '1' (the test launcher sets that before the page runs).
//   PLAYTEST  the tester's furniture: the bug button on the toolbar, the title's Playtest badge and
//             build, Show performance, the weather test chips. #playtest turns it on and remembers it
//             (so a phone keeps it without the address), #playtest=0 turns it off again.
//
// Import this module first in the entry point: it also stops the hooks that other modules install
// at load time from appearing (see sealForeignHooks).

const DEBUG_KEY = 'slopmerica.debug';
const PLAYTEST_KEY = 'slopmerica.playtest';

/** The hash as flags: `#skip&map=florida&debug` gives { skip: '1', map: 'florida', debug: '1' }. */
function hashFlags(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof location === 'undefined') return out;
  for (const part of location.hash.replace(/^#/, '').split('&')) {
    const [k, v] = part.split('=');
    if (k) out[k] = v ?? '1';
  }
  return out;
}

function stored(key: string): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

function store(key: string, value: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the flag lasts for this page only */ }
}

const hash = hashFlags();
const on = (v: string | undefined) => v !== undefined && v !== '0';

// #playtest is remembered so a tester's phone keeps the tools after the address loses it
if (hash.playtest !== undefined) store(PLAYTEST_KEY, on(hash.playtest) ? '1' : null);

/** The tester's furniture is shown. */
export const PLAYTEST: boolean = on(hash.playtest) || (hash.playtest === undefined && stored(PLAYTEST_KEY) === '1');

/** The debug hooks on window are installed. */
export const DEBUG: boolean = !!import.meta.env?.DEV || on(hash.debug) || on(hash.playtest) || stored(DEBUG_KEY) === '1';

/**
 * Hooks installed by modules that set them as they load (the simulation's services and land, the start
 * site, the vault, the building generator's timer). Those modules cannot see this flag without changing
 * them, so when the hooks are off each name becomes a property that reads as undefined and ignores writes:
 * the modules' assignments land nowhere and the game is unchanged. The names stay a public API for tests.
 */
export const FOREIGN_HOOKS = ['__services', '__land', '__startSite', '__vault', '__genMs', '__widening'] as const;

function sealForeignHooks() {
  if (DEBUG || typeof window === 'undefined') return;
  for (const name of FOREIGN_HOOKS) {
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: false, get: () => undefined, set: () => { /* hooks are off */ } });
    } catch { /* already fixed in place: leave it */ }
  }
}
sealForeignHooks();
