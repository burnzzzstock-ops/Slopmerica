// Brand signage painted into the atlas: a wall/fascia sign for every brand
// ("sign:<id>", 4:1), a pole/pylon face for drive-to brands ("pole:<id>") and a
// canopy fascia band for gas brands ("canopy:<id>").
import { defTile, Layer } from './atlas';
import { BRANDS, Brand, signText } from './brands';
import { icon } from './icons';
import { Ctx, F, rr, ellipse, textFit, linesFit, shade, slopScript, slopLightning, distress, rngFor, stripes, drawText, blockSlogan, alpha } from './draw';
import { cannon } from './icons';


/** Styles whose whole panel glows at night (lightboxes); the rest glow letters only. */
function panelGlows(b: Brand) {
  const s = b.sign?.style ?? 'box';
  return s === 'box' || s === 'tiles' || s === 'oval' || s === 'stripes' || s === 'pill';
}

function bg(c: Ctx, L: Layer, b: Brand, color: string, x: number, y: number, w: number, h: number, round = 0) {
  if (L === 'e') {
    if (!panelGlows(b)) return;
    c.fillStyle = shade(color, -0.45);
  } else c.fillStyle = color;
  if (round > 0) {
    rr(c, x, y, w, h, round);
    c.fill();
  } else c.fillRect(x, y, w, h);
}

function frame(c: Ctx, L: Layer, color: string, w: number, h: number, t: number) {
  c.fillStyle = L === 'e' ? '#000' : color;
  c.fillRect(0, 0, w, t);
  c.fillRect(0, h - t, w, t);
  c.fillRect(0, 0, t, h);
  c.fillRect(w - t, 0, t, h);
}

function neonText(c: Ctx, L: Layer, text: string, x: number, y: number, w: number, h: number, family: string, col: string) {
  c.save();
  if (L === 'a') {
    // dark tube outline so the neon reads by day too
    textFit(c, text, x, y, w, h, { family, color: shade(col, -0.15), stroke: shade(col, -0.6), strokeW: 0.06 });
  } else {
    c.shadowColor = col;
    c.shadowBlur = h * 0.25;
    textFit(c, text, x, y, w, h, { family, color: col });
    textFit(c, text, x, y, w, h, { family, color: shade(col, 0.5) });
  }
  c.restore();
}

/** Generic wall sign: icon + name + sub line, per style. */
function paintWall(c: Ctx, w: number, h: number, L: Layer, b: Brand) {
  const s = b.sign ?? { style: 'box' as const };
  const bgc = s.bg ?? b.colors[0];
  const fg = s.fg ?? b.colors[1];
  const acc = s.accent ?? shade(bgc, -0.35);
  const fam = s.font ?? F.sign;
  const text = signText(b);
  const r = rngFor('sign:' + b.id);

  switch (s.style) {
    case 'slopScript': {
      c.fillStyle = L === 'e' ? '#000' : bgc;
      c.fillRect(0, 0, w, h);
      slopScript(c, w / 2, h * 0.42, w * 0.52, fg, { h: h * 0.9 });
      if (L === 'a') distress(c, w * 0.2, 0, w * 0.6, h, bgc, r, 1.4);
      if (L === 'a') {
        textFit(c, 'IMAGINE SUPPLY CO.', w * 0.72, h * 0.72, w * 0.25, h * 0.14, { family: F.sans, weight: 800, color: alpha(fg, 0.7), spacing: 0.1 });
        textFit(c, 'EST. SLOPMERICA', w * 0.03, h * 0.72, w * 0.22, h * 0.14, { family: F.sans, weight: 800, color: alpha(fg, 0.7), spacing: 0.1 });
      }
      return;
    }
    case 'slopLightning': {
      c.fillStyle = L === 'e' ? '#000' : bgc;
      c.fillRect(0, 0, w, h);
      slopLightning(c, 0, h * 0.08, w, h * 0.84, fg);
      return;
    }
    case 'cannon': {
      c.fillStyle = L === 'e' ? '#000' : bgc;
      c.fillRect(0, 0, w, h);
      cannon(c, h * 0.62, h * 0.55, h * 0.95, { smoke: L === 'a', color: '#333' });
      blockSlogan(c, ['SLOP CANNON'], h * 1.25, h * 0.1, w - h * 1.35, h * 0.56, fg);
      textFit(c, s.sub ?? b.tagline ?? '', h * 1.25, h * 0.7, w - h * 1.35, h * 0.2, { family: F.block, color: L === 'e' ? fg : '#efe6cf', spacing: 0.05 });
      return;
    }
    case 'tiles': {
      c.fillStyle = L === 'e' ? '#000' : '#1a1a1a';
      c.fillRect(0, 0, w, h);
      const letters = text.split('');
      const n = letters.length;
      const tw = Math.min(h * 0.86, (w - 16) / n);
      const x0 = (w - tw * n) / 2;
      letters.forEach((ch, i) => {
        if (ch === ' ') return;
        c.fillStyle = L === 'e' ? shade(bgc, -0.2) : bgc;
        c.fillRect(x0 + i * tw + 2, (h - tw) / 2 + 2, tw - 4, tw - 4);
        textFit(c, ch, x0 + i * tw + 4, (h - tw) / 2 + 6, tw - 8, tw - 12, { family: F.sans, weight: 900, color: fg });
      });
      return;
    }
    case 'neon': {
      c.fillStyle = L === 'e' ? '#000' : bgc;
      c.fillRect(0, 0, w, h);
      if (L === 'a') {
        c.strokeStyle = '#2a2a2a';
        c.lineWidth = 3;
        c.strokeRect(4, 4, w - 8, h - 8);
      }
      let x = 12;
      if (s.icon) {
        c.save();
        if (L === 'e') {
          c.shadowColor = acc;
          c.shadowBlur = 12;
        }
        icon(c, s.icon, h * 0.5 + 4, h * 0.5, h * 0.8);
        c.restore();
        x = h + 8;
      }
      neonText(c, L, text, x, h * 0.08, w - x - 12, s.sub ? h * 0.6 : h * 0.84, fam, fg);
      if (s.sub) neonText(c, L, s.sub, x, h * 0.7, w - x - 12, h * 0.2, F.sans, acc);
      return;
    }
    case 'stripes': {
      if (L === 'a') stripes(c, 0, 0, w, h, [bgc, acc], 16, true);
      else {
        c.fillStyle = shade(bgc, -0.5);
        c.fillRect(0, 0, w, h);
      }
      bg(c, L, b, s.bg ?? '#ffffff', w * 0.06, h * 0.12, w * 0.88, h * 0.76, h * 0.12);
      if (L === 'a') {
        c.strokeStyle = fg;
        c.lineWidth = 4;
        rr(c, w * 0.06, h * 0.12, w * 0.88, h * 0.76, h * 0.12);
        c.stroke();
      }
      textFit(c, text, w * 0.1, h * 0.16, w * 0.8, s.sub ? h * 0.5 : h * 0.68, { family: fam, color: fg, stroke: fam === F.script ? undefined : shade(fg, -0.5), strokeW: 0.05 });
      if (s.sub) textFit(c, s.sub, w * 0.1, h * 0.66, w * 0.8, h * 0.16, { family: F.sans, weight: 900, color: acc === bgc ? fg : acc });
      return;
    }
    default:
      break;
  }

  // box / channel / pill / oval / script
  const oval = s.style === 'oval';
  const channel = s.style === 'channel';
  if (L === 'a') {
    c.fillStyle = oval ? shade(acc, -0.2) : channel ? bgc : shade(bgc, -0.4);
    c.fillRect(0, 0, w, h);
  } else if (panelGlows(b)) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
  }
  if (oval) {
    if (L === 'a') {
      ellipse(c, w / 2, h / 2, w * 0.49, h * 0.47);
      c.fillStyle = acc;
      c.fill();
    }
    c.save();
    ellipse(c, w / 2, h / 2, w * 0.47, h * 0.42);
    c.clip();
    bg(c, L, b, bgc, 0, 0, w, h);
    c.restore();
  } else if (!channel) {
    bg(c, L, b, bgc, 5, 5, w - 10, h - 10, s.style === 'pill' ? h * 0.45 : 6);
    if (s.accent && L === 'a') {
      c.fillStyle = s.accent;
      c.fillRect(5, h - 20, w - 10, 9);
    }
  }
  const pad = oval ? w * 0.1 : 14;
  let x = pad;
  if (s.icon) {
    const isz = h * (oval ? 0.72 : 0.84);
    icon(c, s.icon, x + isz * 0.5, h * 0.5, isz);
    x += isz + 8;
  }
  const tw = w - x - pad;
  const hasSub = !!s.sub && !channel;
  const tfam = fam;
  const wt = tfam === F.sans ? 900 : 400;
  textFit(c, text, x, h * (hasSub ? 0.1 : 0.12), tw, h * (hasSub ? 0.56 : 0.76), { family: tfam, weight: wt, color: fg, stroke: s.style === 'script' || channel ? undefined : shade(bgc, -0.5), strokeW: 0.05 });
  if (hasSub) textFit(c, s.sub!, x, h * 0.68, tw, h * 0.2, { family: F.sans, weight: 900, color: fg, spacing: 0.04 });
}

function paintCanopy(c: Ctx, w: number, h: number, L: Layer, b: Brand) {
  const s = b.sign ?? { style: 'box' as const };
  const bgc = b.colors[0];
  const acc = s.accent ?? b.colors[1];
  if (L === 'a') {
    c.fillStyle = bgc;
    c.fillRect(0, 0, w, h);
    c.fillStyle = acc;
    c.fillRect(0, h * 0.72, w, h * 0.16);
    c.fillStyle = '#ffffff';
    c.fillRect(0, h * 0.66, w, h * 0.06);
  } else {
    c.fillStyle = shade(bgc, -0.5);
    c.fillRect(0, 0, w, h * 0.66);
  }
  textFit(c, signText(b).toUpperCase(), w * 0.25, h * 0.08, w * 0.5, h * 0.56, { family: s.font === F.script ? F.sign : s.font ?? F.sign, weight: 900, color: s.fg ?? '#fff' });
}

const SIGN_RES = 0.66; // 512x128 logical -> 338x84 in the atlas

export function registerSigns() {
  for (const b of BRANDS) {
    defTile('sign:' + b.id, 512, 128, (c, w, h, L) => paintWall(c, w, h, L, b), { emissive: true, res: SIGN_RES });
    if ((b.arch ?? []).includes('gas')) defTile('canopy:' + b.id, 512, 64, (c, w, h, L) => paintCanopy(c, w, h, L, b), { emissive: true, wrap: true, res: SIGN_RES });
  }
  // empty tenant slots
  defTile('sign:vacant', 512, 128, (c, w, h, L) => {
    c.fillStyle = L === 'e' ? '#000' : '#e9e6de';
    c.fillRect(0, 0, w, h);
    if (L === 'a') {
      c.strokeStyle = '#b9b5ac';
      c.lineWidth = 6;
      c.strokeRect(6, 6, w - 12, h - 12);
      linesFit(c, ['YOUR BUSINESS HERE', 'CALL CHAD · 555-0142'], 30, 18, w - 60, h - 36, { family: F.sans, weight: 900, color: '#8a867e' });
    }
  }, { emissive: true, res: SIGN_RES });
  defTile('sign:spiritHalloween', 512, 128, (c, w, h, L) => {
    c.fillStyle = L === 'e' ? '#000' : '#fff4e0';
    c.fillRect(0, 0, w, h);
    drawText(c, 'TEMPORARY BANNER', w / 2, h * 0.3, h * 0.18, { family: F.sans, weight: 900, color: L === 'e' ? '#000' : '#999', align: 'center' });
    textFit(c, 'SPECTER HALLOWEEN', 20, h * 0.36, w - 40, h * 0.5, { family: F.marker, color: '#ff7518' });
  }, { emissive: true, res: SIGN_RES });
}
