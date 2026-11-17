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
