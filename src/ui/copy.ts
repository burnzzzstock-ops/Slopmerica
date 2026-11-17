// Sentences the HUD builds from numbers, kept apart from the DOM so a test can read them (scripts/copytest.mjs).

/** "1 building", "3 buildings", "2 days" */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** the toast when a city-wide service failure begins; `clock` says what the game did with the speed */
export function emergencyToast(label: string | undefined, atRisk: number, failing: string | undefined, clock: 'same' | 'slowed' | 'paused') {
  return `🚨 ${label ?? 'Service'} emergency: ${count(atRisk, 'building')} ${failing ?? 'failing'}.${clock === 'same' ? '' : clock === 'slowed' ? ' Slowed to normal speed.' : ' Paused.'}`;
}

/**
 * How long a toast stays up before it starts to fade, in milliseconds: long enough to read. A second to find it and 300 ms a word
 * (about 200 words a minute: a careful reader, on a phone), never under three seconds or over ten. Every toast used to get 2.6 s,
 * which by this count is five words; a refusal that says why and what to do instead runs to twenty.
 */
export function toastMs(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.min(10000, Math.max(3000, 1000 + 300 * words));
}

/** a commune's court date, as the inspector says it */
export const courtText = (days: number) => `⚖️ Court in ${count(Math.max(0, days), 'day')}`;
