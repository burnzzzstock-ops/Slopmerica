import './fonts';
import './style.css';
import { Game } from './game';
import type { MapId } from './world/maps';
import type { Mode } from './sim/sim';
import { debugApi } from './dev/debug';
import { Hud } from './ui/hud';
import { showLoading, showTitle, StartChoice } from './ui/title';
import { autosave } from './sim/save';

const app = document.getElementById('app')!;

function params() {
  const h = location.hash.replace('#', '');
  const out: Record<string, string> = {};
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[k] = decodeURIComponent(v ?? '1');
  }
  return out;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

async function boot() {
  const p = params();
  const choice: StartChoice = p.skip
    ? { map: (p.map as MapId) || 'appalachia', mode: (p.mode as Mode) || 'ponzi', cityName: p.city || '' }
    : await showTitle(app);
  const loading = showLoading(app);
  await nextFrame();
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are optional */
  }
  const game = await Game.create(app, { map: choice.map, mode: choice.mode, cityName: choice.cityName, restore: choice.restore });
  autosave(game);
  const hud = new Hud(game, app);
  game.onFrame.push((dt) => hud.update(dt));
  (window as any).__game = game;
  (window as any).__dbg = debugApi(game);
  game.start();
  loading.done();
  const unlock = () => {
    game.audio.unlock();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}
boot();
