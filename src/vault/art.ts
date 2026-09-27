// The Asset Vault's signs, one per family, painted in the vault's own layout
// (colour field, monogram box, name, satire line) on the satire sheet. They
// light up at night.
import { defTile, type Layer } from '../art/atlas';
import { F, textFit, shade, type Ctx } from '../art/draw';
import { VAULT_FAMILIES, type VaultFamily } from './families';

export const vaultSignTile = (id: string) => 'vs:' + id;

function paint(c: Ctx, w: number, h: number, L: Layer, f: VaultFamily) {
  const night = L === 'e';
  c.fillStyle = night ? shade(f.bg, -0.72) : f.bg;
  c.fillRect(0, 0, w, h);
  // monogram box
  const bs = h * 0.42;
  c.fillStyle = night ? shade(f.box, -0.35) : f.box;
  c.fillRect(h * 0.07, h * 0.07, bs, bs);
  textFit(c, f.mono, h * 0.07 + bs * 0.1, h * 0.07 + bs * 0.18, bs * 0.8, bs * 0.64, { family: F.sans, weight: 800, color: night ? shade(f.bg, -0.4) : f.bg });
  // name, divider, line
  const x0 = h * 0.07 + bs + h * 0.08;
  textFit(c, f.sign.toUpperCase(), x0, h * 0.08, w - x0 - h * 0.07, bs * 0.9, { family: F.sans, weight: 800, color: f.ink });
  c.fillStyle = f.ink;
  c.globalAlpha = night ? 0.35 : 0.5;
  c.fillRect(h * 0.07, h * 0.55, w - h * 0.14, Math.max(2, h * 0.012));
  c.globalAlpha = 1;
  textFit(c, (f.line || f.satire).toUpperCase(), h * 0.08, h * 0.62, w - h * 0.16, h * 0.28, { family: F.sans, weight: 700, color: f.ink });
}

/** the vault's glass: blue-grey panes by day, lit rooms (a few dark) by night */
function paintGlass(c: Ctx, w: number, h: number, L: Layer) {
  const pw = w / 2, ph = h / 2;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x = i * pw, y = j * ph;
    if (L === 'e') {
      const dark = i === 1 && j === 0;
      const g = c.createLinearGradient(0, y, 0, y + ph);
      g.addColorStop(0, dark ? '#101216' : i ? '#b8c8e8' : '#d8b878');
      g.addColorStop(1, dark ? '#050608' : i ? '#3a4458' : '#4a3a22');
      c.fillStyle = g;
    } else {
      const g = c.createLinearGradient(x, y, x + pw * 0.6, y + ph);
      g.addColorStop(0, '#9ab2c4');
      g.addColorStop(1, '#34424e');
      c.fillStyle = g;
    }
    c.fillRect(x, y, pw, ph);
  }
  // mullions
  c.fillStyle = L === 'e' ? '#000' : '#2a2e33';
  c.fillRect(0, 0, w, 4); c.fillRect(0, ph - 2, w, 4); c.fillRect(0, 0, 4, h); c.fillRect(pw - 2, 0, 4, h);
}

export function registerVaultArt() {
  defTile('vaultGlass', 128, 128, paintGlass, { wrap: true, emissive: true });
  for (const f of VAULT_FAMILIES) defTile(vaultSignTile(f.id), 512, 200, (c, w, h, L) => paint(c, w, h, L, f), { sheet: 'sat', res: 0.3, emissive: true });
}
