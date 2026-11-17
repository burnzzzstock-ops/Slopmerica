// The simulation's clock.
/** Fixed steps in one game day. A day is 2.5 game seconds (DAY_SECONDS in sim/sim.ts), so a step is 0.078125 s. */
export const STEPS_PER_DAY = 32;
/**
 * The fixed step everything in the simulation advances by, in game seconds. Traffic was tuned at 0.08 s; this is the nearest
 * step that divides a day into a whole number (a power of two, so the calendar adds up with no rounding: after 32 steps the
 * day counter has moved by exactly 1, and a daily tick falls on the same step every day).
 */
export const STEP_SECONDS = 2.5 / STEPS_PER_DAY;
/**
 * The speed (x4, the top one) at which the game's real-time clocks were tuned and tested: how long someone waits at a door, how long
 * a bus dwells, how long a commune takes to pack up. Those clocks now run in game time at the pace they had at this speed, so they
 * are the same at every speed and every frame rate.
 */
export const TOP_SPEED = 4;
