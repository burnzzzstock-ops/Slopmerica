// Sentences the HUD builds from numbers, kept apart from the DOM so a test can read them (scripts/copytest.mjs).

/** "1 building", "3 buildings", "2 days" */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** the toast when a city-wide service failure begins; `clock` says what the game did with the speed */
export function emergencyToast(label: string | undefined, atRisk: number, failing: string | undefined, clock: 'same' | 'slowed' | 'paused') {
  return `🚨 ${label ?? 'Service'} emergency: ${count(atRisk, 'building')} ${failing ?? 'failing'}.${clock === 'same' ? '' : clock === 'slowed' ? ' Slowed to normal speed.' : ' Paused.'}`;
}

/** a commune's court date, as the inspector says it */
export const courtText = (days: number) => `⚖️ Court in ${count(Math.max(0, days), 'day')}`;
