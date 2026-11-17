// The one place that knows where the browser is and how to start it. Every script that drives the game imports from here.
//
//   import { launch } from './lib/browser.mjs';
//   const browser = await launch();                        // software WebGL (SwiftShader): the same pixels on every machine
//   const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });   // extra Chromium flags
//   const browser = await launch({ gl: false });           // no WebGL flags at all (offline audio renders)
//   const browser = await launch({ debug: false });        // pages see the game as a player does: no debug hooks, no playtest tools
//
// A production build installs the debug hooks (window.__game, __dbg, ...) and shows the playtest tools only when asked (src/core/flags.ts).
// So every page and context this browser opens gets an init script, run before the page's own code, that asks for both: the same test
// then works against the dev server and against a built game. `debug: false` leaves it out.
//
// env: CHROME (or CHROME_PATH)  the browser to run. Without it: Playwright's own Chromium when it is installed, else the system Chrome
//                               on Windows and macOS, else the container's /opt/pw-browsers build.
//      GPU=1                    the real graphics card (ANGLE on D3D11 / Metal / GL) instead of SwiftShader, for speed and perf numbers.
//                               Pixels then depend on the card and its driver: never compare screenshots across machines with it.
//      HEADED=1                 show the window.
// launch() takes a browser slot first (scripts/lib/slots.mjs), so no more than SLOTS browsers run at once from one checkout.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { takeSlot } from './slots.mjs';

const CONTAINER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
function find() {
  const env = process.env.CHROME || process.env.CHROME_PATH;
  if (env) return env;
  try { const own = chromium.executablePath(); if (own && existsSync(own)) return own; } catch { /* not installed */ }
  const system = process.platform === 'win32'
    ? [`${process.env.PROGRAMFILES || 'C:/Program Files'}/Google/Chrome/Application/chrome.exe`, `${process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)'}/Google/Chrome/Application/chrome.exe`, `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : [];
  return system.find((p) => existsSync(p)) ?? CONTAINER;
}

/** The browser every script runs. */
export const EXE = find();
/** True when the real graphics card draws (GPU=1). */
export const GPU = process.env.GPU === '1';
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
/** The WebGL flags: SwiftShader unless GPU=1. */
export const ARGS = GPU
  ? [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--no-sandbox']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

/** Runs in every frame before the game's code: turn on the debug hooks and the playtest tools (a sandboxed frame may have no storage). */
function askForDebug() {
  try { localStorage.setItem('slopmerica.debug', '1'); localStorage.setItem('slopmerica.playtest', '1'); } catch { /* no storage here */ }
}

/**
 * Start the browser. `args` are added to the WebGL flags; `gl: false` starts it with no WebGL flags (only --no-sandbox);
 * `debug: false` opens pages without the debug init script; anything else goes to Playwright's chromium.launch as it is.
 */
export async function launch({ gl = true, args = [], debug = true, ...rest } = {}) {
  if (!existsSync(EXE)) throw new Error(`No browser at ${EXE}. Set CHROME to a Chrome or Chromium executable.`);
  await takeSlot();
  const flags = [...(gl ? ARGS : ['--no-sandbox']), ...args.filter((a) => !(gl ? ARGS : ['--no-sandbox']).includes(a))];
  const browser = await chromium.launch({ executablePath: EXE, headless: process.env.HEADED !== '1', ...rest, args: flags });
  if (debug) {
    // a context's init scripts run in every page it opens, so its pages need nothing more; a page from browser.newPage is
    // still on about:blank when it gets the script, so the first goto already runs it
    const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
    browser.newContext = async (...a) => { const ctx = await newContext(...a); await ctx.addInitScript(askForDebug); return ctx; };
    browser.newPage = async (...a) => { const page = await newPage(...a); await page.addInitScript(askForDebug); return page; };
  }
  return browser;
}

export { chromium };
