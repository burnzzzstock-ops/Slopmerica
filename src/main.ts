import './fonts';
import './style.css';
import { crumb, installErrorCapture, openBugReport, showBootFailure, showContextLost } from './ui/bugreport';
// before anything else runs, so crashes while loading are caught too
installErrorCapture();
import { Game } from './game';
import type { MapId } from './world/maps';
import type { Mode } from './sim/sim';
import { debugApi } from './dev/debug';
import { Hud } from './ui/hud';
import { showLoading, showTitle, StartChoice } from './ui/title';
import { autosave, rawSave, saveGame, shelveBrokenSave } from './sim/save';

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
  crumb(`${choice.restore ? 'resumed' : 'new city'} · ${choice.map} · ${choice.mode}`);
  let game: Game;
  try {
    game = await Game.create(app, { map: choice.map, mode: choice.mode, cityName: choice.cityName, restore: choice.restore });
    autosave(game);
    const hud = new Hud(game, app);
    game.onFrame.push((dt) => hud.update(dt));
    (window as any).__game = game;
    (window as any).__dbg = debugApi(game);
    game.start();
  } catch (err) {
    loading.done();
    showBootFailure(document.body, err, { restoring: !!choice.restore, savedJSON: choice.restore ? rawSave() : null, shelveSave: shelveBrokenSave });
    return;
  }
  loading.done();
  // a lost WebGL context renders nothing until reload: save and say so
  game.renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    crumb('WebGL context lost');
    saveGame(game);
    showContextLost(document.body, () => openBugReport(document.body, game, { kind: 'Broken', prefill: 'The graphics crashed (screen froze or went black).' }));
  });
  const unlock = () => {
    game.audio.unlock();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}
boot().catch((err) => {
  // anything before the game exists (the title reading an old save, say)
  document.querySelector('.loading')?.remove();
  const saved = rawSave();
  showBootFailure(document.body, err, { restoring: !!saved, savedJSON: saved, shelveSave: shelveBrokenSave });
});
