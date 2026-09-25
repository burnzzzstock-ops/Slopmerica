// Art entry point: registers every tile family with the atlas (in a fixed order
// so the layout is deterministic) and exposes the atlas API.
import { addRegistrar, paintAtlas } from './atlas';
import { registerFacades } from './facades';
import { registerSigns } from './signs';
import { registerBillboards } from './billboards';
import { registerLandmarkArt } from './landmarkArt';
import { F } from './draw';

addRegistrar(registerFacades);
addRegistrar(registerSigns);
addRegistrar(registerBillboards);
addRegistrar(registerLandmarkArt);

export { T, hasTile, tileNames, atlasStats, atlasTextures, atlasPainted } from './atlas';
export type { Tile } from './atlas';

/** Wait for the sign fonts (index.html loads them), then paint the atlas. */
export function paintArt() {
  const fams = [F.script, F.block, F.sign, F.round, F.marker].map((f) => `40px "${f}"`);
  const sans = [400, 800, 900].map((w) => `${w} 40px "${F.sans}"`);
  return paintAtlas([...fams, ...sans]);
}
