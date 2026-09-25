// Hero art for landmarks, apartment name signs and Times Square screens.
import { defTile, Layer, Painter } from './atlas';
import { APT_NAMES, COUNTY_NAMES, SCREEN_ADS } from './names';
import { Ctx, F, textFit, linesFit, circle, stripes, slopScript, slopLightning, distress, rngFor, gradV, shade, blockSlogan, speckle } from './draw';
import { icon, wigette, cannonBoys, fillErUpGuy, neuralFly, pigHead } from './icons';

function fill(c: Ctx, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(0, 0, w, h);
}

// Atlas resolution per landmark tile (painters keep their logical sizes).
const LM_RES: Record<string, number> = {
  'lm:field': 0.6, 'lm:scoreboard': 0.75, 'lm:neuralLogo': 0.6, 'lm:fillErUpBig': 0.6, 'lm:cannonPlaque': 0.75, 'lm:pigCabana': 0.75,
  'lm:propaneParadise': 0.75, 'lm:slopHQ': 0.6, 'lm:church': 0.75, 'lm:churchMarquee': 0.75, 'lm:stadiumSign': 0.75,
  'lm:cannonBanner': 0.75, 'lm:neuralSign': 0.75, 'lm:tankLabel': 0.6, 'lm:cannonSign': 0.75,
};

function lm(name: string, w: number, h: number, paint: Painter, o: { wrap?: boolean; emissive?: boolean; res?: number } = {}) {
  defTile(name, w, h, paint, { ...o, res: LM_RES[name] ?? (name.startsWith('lm:tower:') ? 0.6 : o.res ?? 1) });
}

export function registerLandmarkArt() {  // ---------------------------------------------------------------- Slop Cannon
  lm('lm:cannonSign', 1024, 160, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#111');
    if (L === 'a') {
      c.strokeStyle = '#c6f432';
      c.lineWidth = 6;
      c.strokeRect(8, 8, w - 16, h - 16);
    }
    blockSlogan(c, ['GET IN THE F*CKING CANNON'], 30, 18, w - 60, h - 36, '#c6f432');
  }, { emissive: true, res: 0.75 });
  lm('lm:cannonPlaque', 512, 192, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#6b4a2a');
    if (L === 'e') return;
    c.strokeStyle = '#caa24a';
    c.lineWidth = 6;
    c.strokeRect(10, 10, w - 20, h - 20);
    slopScript(c, w * 0.28, h * 0.42, w * 0.4, '#efe6cf');
    linesFit(c, ["WORLD'S LARGEST CANNON", 'RIDE AT YOUR OWN RISK', 'NO REFUNDS · NO LANDINGS'], w * 0.5, 30, w * 0.46, h - 60, { family: F.block, color: '#efe6cf' });
  }, { emissive: true });
  lm('lm:cannonBanner', 512, 128, (c, w, h) => {
    fill(c, w, h, '#c6f432');
    cannonBoys(c, h * 0.9, h * 0.52, h * 0.95);
    textFit(c, 'LOOSE CANNON · SHORT FUSE', h * 1.8, 18, w - h * 1.9, h * 0.34, { family: F.block, color: '#111' });
    textFit(c, 'PLAY WITH FIRE', h * 1.8, h * 0.58, w - h * 1.9, h * 0.3, { family: F.block, color: '#b3202a' });
  });

  // ---------------------------------------------------------------- Slop 69 Field
  lm('lm:field', 512, 512, (c, w, h) => {
    const r = rngFor('field');
    // outfield grass with mow stripes, fan from home plate at bottom center
    for (let i = 0; i < 16; i++) {
      c.fillStyle = i % 2 ? '#4f8a33' : '#5c9a3c';
      c.fillRect(0, (i * h) / 16, w, h / 16);
    }
    speckle(c, w, h, r, 4000, 0.1, 0.06, 1.5);
    const hx = w / 2, hy = h * 0.92;
    // warning track arc
    c.strokeStyle = '#a0704a';
    c.lineWidth = 18;
    c.beginPath();
    c.arc(hx, hy, h * 0.86, Math.PI * 1.25, Math.PI * 1.75);
    c.stroke();
    // infield dirt
    c.fillStyle = '#b07a4a';
    c.beginPath();
    c.moveTo(hx, hy);
    c.arc(hx, hy, h * 0.4, Math.PI * 1.25, Math.PI * 1.75);
    c.closePath();
    c.fill();
    // infield grass diamond
    const d = h * 0.2;
    c.fillStyle = '#5c9a3c';
    c.beginPath();
    c.moveTo(hx, hy - 12);
    c.lineTo(hx + d * 0.92, hy - d * 0.92 - 6);
    c.lineTo(hx, hy - d * 1.84);
    c.lineTo(hx - d * 0.92, hy - d * 0.92 - 6);
    c.closePath();
    c.fill();
    // base paths + foul lines
    c.strokeStyle = '#f4f1ea';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(hx, hy);
    c.lineTo(hx + h * 0.7, hy - h * 0.7);
    c.moveTo(hx, hy);
    c.lineTo(hx - h * 0.7, hy - h * 0.7);
    c.stroke();
    // bases
    c.fillStyle = '#fff';
    for (const [bx, by] of [[d * 1.0, -d * 1.0], [0, -d * 2.0], [-d * 1.0, -d * 1.0]]) {
      c.save();
      c.translate(hx + bx, hy + by);
      c.rotate(Math.PI / 4);
      c.fillRect(-5, -5, 10, 10);
      c.restore();
    }
    // mound + plate
    c.fillStyle = '#b07a4a';
    circle(c, hx, hy - d, 16);
    c.fill();
    c.fillStyle = '#fff';
    c.fillRect(hx - 5, hy - d - 1, 10, 2.5);
    c.fillStyle = '#b07a4a';
    circle(c, hx, hy, 22);
    c.fill();
    c.fillStyle = '#fff';
    c.fillRect(hx - 5, hy - 5, 10, 8);
    // mowed logo in center field
    c.save();
    c.globalAlpha = 0.25;
    slopScript(c, hx, h * 0.3, w * 0.34, '#2a5a1a', { tail: true });
    c.restore();
  });
  lm('lm:scoreboard', 512, 320, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#15251c');
    if (L === 'a') {
      c.strokeStyle = '#efe6cf';
      c.lineWidth = 6;
      c.strokeRect(6, 6, w - 12, h - 12);
      pinstripeBand(c, 12, 12, w - 24, 90);
    }
    if (L === 'a') slopScript(c, w * 0.38, 54, w * 0.4, '#1d3a8a', { outline: '#efe6cf', h: 84 });
    textFit(c, '69', w * 0.62, 18, w * 0.26, 78, { family: F.block, color: L === 'e' ? '#ff4b3a' : '#b3202a' });
    // inning grid
    const cols = 9;
    const gx = 24, gy = 120, gw = w - 48, cw = gw / (cols + 3);
    const rows: [string, string[]][] = [['HOME', ['0', '0', '1', '0', '2', '0', '3', '0', 'X']], ['VISITORS', ['4', '0', '0', '0', '5', '0', '0', '0', '0']]];
    for (let i = 0; i < cols; i++) textFit(c, String(i + 1), gx + cw * (i + 2), gy, cw, 24, { family: F.sans, weight: 900, color: '#efe6cf' });
    textFit(c, 'R', gx + cw * 11, gy, cw, 24, { family: F.sans, weight: 900, color: '#ffd400' });
    rows.forEach(([team, runs], j) => {
      const y = gy + 32 + j * 44;
      textFit(c, team, gx, y + 4, cw * 2 - 6, 30, { family: F.sans, weight: 900, color: '#efe6cf', align: 'left' });
      runs.forEach((rn, i) => textFit(c, rn, gx + cw * (i + 2), y, cw, 38, { family: F.sign, color: '#ffd400' }));
      textFit(c, j === 0 ? '6' : '9', gx + cw * 11, y, cw, 38, { family: F.sign, color: '#ff4b3a' });
    });
    c.fillStyle = L === 'e' ? '#000' : '#0a0f0c';
    c.fillRect(20, h - 62, w - 40, 44);
    textFit(c, 'GET IN THE CANNON · 69¢ DRAFTS · NO REFUNDS', 30, h - 56, w - 60, 32, { family: F.sign, color: '#c6f432' });
  }, { emissive: true });
  lm('lm:outfield', 512, 64, (c, w, h, L) => {
    const ads: [string, string, string][] = [['SLOP ENERGY', '#111', '#c6f432'], ['FILL ER UP', '#b3202a', '#fff'], ['NEURAL FLY', '#07070f', '#34f5ff'], ['PIG CABANA', '#12a39a', '#ffe7ef']];
    ads.forEach(([t, bg, fg], i) => {
      c.fillStyle = L === 'e' ? shade(bg, -0.4) : bg;
      c.fillRect((i * w) / 4 + 2, 2, w / 4 - 4, h - 4);
      textFit(c, t, (i * w) / 4 + 8, 8, w / 4 - 16, h - 16, { family: F.block, color: fg });
    });
  }, { emissive: true, wrap: true });
  lm('lm:stadiumSign', 512, 128, (c, w, h, L) => {
    if (L === 'a') pinstripeBand(c, 0, 0, w, h);
    else fill(c, w, h, '#000');
    slopScript(c, w * 0.32, h * 0.42, w * 0.36, '#1d3a8a', { outline: '#efe6cf', h: h * 0.9 });
    textFit(c, '69 FIELD', w * 0.54, h * 0.18, w * 0.42, h * 0.62, { family: F.block, color: '#b3202a', stroke: '#efe6cf', strokeW: 0.05 });
  }, { emissive: true });

  // ---------------------------------------------------------------- Pig Cabana
  lm('lm:pigCabana', 512, 192, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#12a39a');
    if (L === 'a') {
      c.fillStyle = '#0d7f78';
      for (let i = 0; i < 8; i++) c.fillRect(i * 64 + 30, 0, 6, h);
    }
    pigHead(c, h * 0.55, h * 0.52, h * 0.9, { starShades: true, grin: true });
    textFit(c, 'PIG CABANA', h * 1.05, 16, w - h * 1.15, h * 0.5, { family: F.round, color: '#ffe7ef', stroke: '#b3124a', strokeW: 0.08 });
    textFit(c, 'RESORT · SPA · PULLED PORK', h * 1.05, h * 0.66, w - h * 1.15, h * 0.2, { family: F.sans, weight: 900, color: L === 'e' ? '#ff9ecf' : '#063b37' });
  }, { emissive: true });
  lm('lm:cabanaStripe', 128, 128, (c, w, h) => stripes(c, 0, 0, w, h, ['#ff6f91', '#fff6f0'], 8, true), { wrap: true });

  // ---------------------------------------------------------------- Neural Fly
  lm('lm:neuralLogo', 512, 512, (c, w, h, L) => {
    fill(c, w, h, '#07070f');
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = ['#ff2bd6', '#34f5ff', '#c6f432', '#ffb800', '#7a2bff'][i];
      c.lineWidth = 6;
      circle(c, w / 2, h / 2, 120 + i * 24);
      c.stroke();
    }
    neuralFly(c, w / 2, h / 2, h * 0.62);
  }, { emissive: true, res: 0.75 });
  lm('lm:neuralSign', 512, 128, (c, w, h, L) => {
    fill(c, w, h, '#07070f');
    textFit(c, 'NEURAL FLY', 16, 8, w - 32, h * 0.56, { family: F.sign, color: '#34f5ff' });
    textFit(c, 'RESERVOIR USED TODAY: 4.2 BILLION GAL · COMPUTE GOES BRRR', 16, h * 0.7, w - 32, h * 0.2, { family: F.sans, weight: 900, color: '#ff2bd6' });
  }, { emissive: true });

  // ---------------------------------------------------------------- Propane Paradise
  lm('lm:propaneParadise', 512, 192, (c, w, h, L) => {
    if (L === 'a') gradV(c, 0, 0, w, h, '#ffb35c', '#ff6f91');
    else fill(c, w, h, '#3a1a10');
    icon(c, 'propane', h * 0.4, h * 0.52, h * 0.8);
    icon(c, 'palm', h * 0.85, h * 0.5, h * 0.9);
    textFit(c, 'PROPANE PARADISE', h * 1.25, 18, w - h * 1.35, h * 0.46, { family: F.round, color: '#fff', stroke: '#8a2a0a', strokeW: 0.08 });
    textFit(c, 'SUN · SAND · PRESSURIZED GAS', h * 1.25, h * 0.64, w - h * 1.35, h * 0.2, { family: F.sans, weight: 900, color: '#3b1f14' });
  }, { emissive: true });
  lm('lm:shirtPattern', 256, 256, (c, w, h) => {
    fill(c, w, h, '#12a39a');
    const r = rngFor('shirt');
    const items = ['palm', 'propane', 'flame', 'sun'];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      icon(c, items[(i + j) % 4], i * 64 + 32 + (j % 2) * 16 - 8, j * 64 + 32, 44 + r.float() * 6);
    }
  }, { wrap: true });
  lm('lm:tankLabel', 512, 128, (c, w, h) => {
    fill(c, w, h, '#f3f3f0');
    c.fillStyle = '#1d4fa3';
    c.fillRect(0, h * 0.72, w, h * 0.12);
    textFit(c, 'PROPANE PARADISE', 30, 16, w * 0.62, h * 0.5, { family: F.round, color: '#12a39a' });
    textFit(c, 'FLAMMABLE · NO SMOKING · NO VAPING · NO VIBES', 30, h * 0.52, w * 0.62, h * 0.16, { family: F.sans, weight: 900, color: '#b3202a' });
    icon(c, 'flame', w * 0.85, h * 0.4, h * 0.6);
  });

  // ---------------------------------------------------------------- Fill Er Up Mega Station
  lm('lm:fillErUpBig', 768, 256, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#f4efe2');
    fillErUpGuy(c, h * 0.62, h * 0.5, h * 0.95, true);
    textFit(c, 'FILL ER UP', h * 1.3, 14, w - h * 1.4, h * 0.46, { family: F.sign, color: '#b3202a', stroke: '#1d3a8a', strokeW: 0.05 });
    linesFit(c, ['120 PUMPS · 80 TOILETS · JERKY WALL', 'BRISKET · FIREWORKS · SLOP APPAREL'], h * 1.3, h * 0.58, w - h * 1.4, h * 0.34, { family: F.sans, weight: 900, color: '#1d3a8a' });
  }, { emissive: true, res: 0.75 });

  // ---------------------------------------------------------------- Megachurch
  lm('lm:church', 512, 128, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#fff8e1');
    icon(c, 'cross', h * 0.5, h * 0.5, h * 0.8);
    textFit(c, 'PROSPERITY DOME', h, 14, w - h - 16, h * 0.54, { family: F.serif, weight: 700, color: '#6a1b9a' });
    textFit(c, 'SEATING FOR 12,000 · PARKING FOR 4,000', h, h * 0.7, w - h - 16, h * 0.18, { family: F.sans, weight: 900, color: '#8a6d3b' });
  }, { emissive: true });
  lm('lm:churchMarquee', 384, 192, (c, w, h, L) => {
    fill(c, w, h, '#050505');
    linesFit(c, ['EASTER PARKING NOW OPEN', 'LOTS A THRU ZZ', 'COFFEE BAR · LASER TAG FRI'], 14, 14, w - 28, h - 28, { family: F.sign, color: '#ffb000' });
  }, { emissive: true });

  // ---------------------------------------------------------------- water tower names
  for (const [id, name] of Object.entries(COUNTY_NAMES)) {
    lm('lm:tower:' + id, 512, 128, (c, w, h) => {
      fill(c, w, h, '#dfe6ea');
      textFit(c, name, 16, 10, w - 32, h * 0.66, { family: F.block, color: '#1d3a8a' });
      textFit(c, "CLASS OF '09 · KYLE WAS HERE", w * 0.55, h * 0.8, w * 0.4, h * 0.14, { family: F.marker, color: '#b3202a' });
    }, { res: 0.75 });
  }

  // ---------------------------------------------------------------- apartment name signs
  APT_NAMES.forEach((n, i) => {
    defTile('apt:' + i, 512, 96, (c, w, h, L) => {
      fill(c, w, h, L === 'e' ? '#000' : '#2b2d31');
      textFit(c, n, 16, 10, w - 32, h - 20, { family: i % 3 === 0 ? F.script : i % 3 === 1 ? F.serif : F.sans, weight: 700, color: '#f4efe2' });
    }, { emissive: true, res: 0.6 });
  });

  // ---------------------------------------------------------------- Times Square screens (bright by day, glow at night)
  SCREEN_ADS.forEach((id) => {
    defTile('scr:' + id, 320, 200, (c, w, h) => screen(c, w, h, id), { emissive: true, res: 0.64 });
  });

  // SLOP HQ crown sign (square-ish, lit)
  lm('lm:slopHQ', 512, 256, (c, w, h, L) => {
    fill(c, w, h, L === 'e' ? '#000' : '#111');
    slopScript(c, w / 2, h * 0.4, w * 0.8, '#efe6cf', { h: h * 0.72 });
    if (L === 'a') distress(c, 0, 0, w, h, '#111', rngFor('hq'), 0.8);
    textFit(c, 'WORLD HEADQUARTERS · IMAGINESUPPLY.CO', w * 0.1, h * 0.78, w * 0.8, h * 0.12, { family: F.sans, weight: 900, color: '#c6f432' });
  }, { emissive: true, res: 0.75 });
}

function pinstripeBand(c: Ctx, x: number, y: number, w: number, h: number) {
  c.fillStyle = '#f4efe2';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#1d3a8a';
  for (let xx = x + 6; xx < x + w; xx += 12) c.fillRect(xx, y, 1.5, h);
}

function screen(c: Ctx, w: number, h: number, id: string) {
  switch (id) {
    case 'slop':
      fill(c, w, h, '#111');
      slopScript(c, w / 2, h * 0.4, w * 0.8, '#efe6cf', { h: h * 0.68 });
      textFit(c, 'imaginesupply.co', 20, h * 0.76, w - 40, h * 0.14, { family: F.sans, weight: 900, color: '#c6f432' });
      break;
    case 'lightning':
      fill(c, w, h, '#111');
      slopLightning(c, 0, h * 0.25, w, h * 0.5, '#f7d117');
      break;
    case 'neural':
      fill(c, w, h, '#07070f');
      neuralFly(c, w / 2, h * 0.45, h * 0.7);
      textFit(c, 'NEURAL FLY', 20, h * 0.8, w - 40, h * 0.14, { family: F.sign, color: '#34f5ff' });
      break;
    case 'sloptok':
      gradV(c, 0, 0, w, h, '#fe2c55', '#25f4ee');
      textFit(c, 'SLOPTOK', 16, h * 0.2, w - 32, h * 0.4, { family: F.sign, color: '#111' });
      textFit(c, '3.2B VIEWS · 0 THOUGHTS', 16, h * 0.64, w - 32, h * 0.16, { family: F.sans, weight: 900, color: '#fff' });
      break;
    case 'bitcorn':
      fill(c, w, h, '#0b0f1a');
      icon(c, 'coin', w * 0.25, h * 0.5, h * 0.7);
      textFit(c, 'BITCORN', w * 0.45, h * 0.18, w * 0.5, h * 0.3, { family: F.sign, color: '#f5b300' });
      textFit(c, '▲ 4,269%', w * 0.45, h * 0.52, w * 0.5, h * 0.3, { family: F.sign, color: '#2ecc71' });
      break;
    case 'chick':
      fill(c, w, h, '#d71920');
      icon(c, 'chicken', w / 2, h * 0.4, h * 0.6);
      textFit(c, 'CLOSED. EH.', 20, h * 0.74, w - 40, h * 0.18, { family: F.script, color: '#fff' });
      break;
    case 'wigette':
      gradV(c, 0, 0, w, h, '#ff9ecf', '#ff5ab0');
      wigette(c, w / 2, h * 0.5, h * 0.9);
      break;
    default:
      fill(c, w, h, '#0a2a5a');
      c.fillStyle = '#b3202a';
      c.fillRect(0, h * 0.62, w, h * 0.24);
      textFit(c, 'BREAKING', 16, h * 0.1, w * 0.6, h * 0.24, { family: F.sans, weight: 900, color: '#fff' });
      textFit(c, 'ROUTE 9 WIDENED; TRAFFIC WORSE', 12, h * 0.64, w - 24, h * 0.2, { family: F.sans, weight: 900, color: '#fff' });
      textFit(c, 'EXPERTS STUNNED', 16, h * 0.38, w * 0.8, h * 0.2, { family: F.block, color: '#ffd400', align: 'left' });
  }
}
