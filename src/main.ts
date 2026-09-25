import './style.css';
import { Game, GameMode } from './game';
import type { MapId } from './world/maps';

const app = document.getElementById('app')!;

function params() {
  const h = location.hash.replace('#', '');
  const out: Record<string, string> = {};
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[k] = v ?? '1';
  }
  return out;
}

const p = params();
const game = new Game(app, { map: (p.map as MapId) || 'appalachia', mode: (p.mode as GameMode) || 'ponzi' });
(window as any).__game = game;
game.start();
