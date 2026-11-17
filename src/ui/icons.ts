// The drawn HUD icons (src/art/hudIcons.ts), by the control they stand on. A control that has no drawn icon keeps the emoji
// it had, so a new tool or building never shows an empty square.
import { HUD_CONTROLS, hudIconFor } from '../art/hudIcons';

export type IconGroup = keyof typeof HUD_CONTROLS;

/**
 * The icon for a control: inline SVG when one is drawn for `id` in `group`, else `fallback` (the emoji). It is decoration:
 * the control carries its own name in text or in a label.
 */
export function uiIcon(group: IconGroup, id: string, fallback: string, size = 24): string {
  const svg = hudIconFor(group, id, size);
  return svg ? `<span class="ui-icon">${svg}</span>` : fallback;
}

/** what a "do this" button does, to the control whose drawing stands for it */
const ACT: Record<string, [IconGroup, string]> = { road: ['toolbar', 'roads'], budget: ['toolbar', 'budget'], svc: ['toolbar', 'ext:services'], speed: ['action', 'play'], play: ['action', 'play'], pause: ['action', 'pause'], show: ['action', 'show'] };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The words of a "do this" button with its drawn icon in front, as HTML (the words are escaped). The icon is picked by what the
 * button does (`zone:resLow`, `fix:power`, `road`, `budget`, `svc`, `speed`, `pause`, `play`, `show`), not by the emoji its
 * label was written with: that emoji gives way to the drawing. A button whose action has no drawing is shown as written.
 */
export function actLabel(act: string, label: string, size = 18): string {
  const [group, id] = act.startsWith('zone:') ? (['zone', act.slice(5)] as const) : act.startsWith('fix:') ? (['category', act.slice(4)] as const) : ACT[act] ?? ([null, ''] as const);
  const drawn = group ? uiIcon(group, id, '', size) : '';
  return drawn ? `${drawn} ${esc(label.replace(/^[^\p{L}\p{N}]+/u, ''))}` : esc(label);
}
