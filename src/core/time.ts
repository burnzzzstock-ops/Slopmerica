// The simulation's clock.
/** The fixed step everything in the simulation advances by, in game seconds. Traffic was tuned at it; nothing may step by anything else. */
export const STEP_SECONDS = 0.08;
/**
 * The speed (x4, the top one) at which the game's real-time clocks were tuned and tested: how long someone waits at a door, how long
 * a bus dwells, how long a commune takes to pack up. Those clocks now run in game time at the pace they had at this speed, so they
 * are the same at every speed and every frame rate.
 */
export const TOP_SPEED = 4;
