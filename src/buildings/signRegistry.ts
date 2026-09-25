// Extra atlas signs registered by gameplay systems (service buildings, transit,
// ...). Push before the facade atlas is first built (i.e. at module import time).
import type { SignFont } from '../art/brands';

export interface ExtraSign { id: string; text: string; colors: [string, string]; font: SignFont }
export const EXTRA_SIGNS: ExtraSign[] = [];
export const registerSigns = (...s: ExtraSign[]) => { EXTRA_SIGNS.push(...s); };
