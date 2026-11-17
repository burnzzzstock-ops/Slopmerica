// Every number a new system adds goes here, in one place the owner can read and change.
// PROPOSED means: measured or reasoned, working in the game, and waiting for the owner's yes (docs/aaa/DECISIONS_FABLE.md
// lists each with the evidence). Numbers that were in the game before this file stay where they were.

export const TUNING = {
  // ---- what the look and the sound read (src/sim/fields.ts)
  /** PROPOSED: air pollution at which a place counts as smoggy (the level services already treat as the worst for land value) */
  smogCell: 2.5,
  /** PROPOSED: share of the map that must be that smoggy for the sky to be fully sepia (an eighth: about a big industrial belt) */
  smogFullShare: 0.125,
  /** PROPOSED: days an abandoned building takes to read as fully derelict (the same 90 days it stands before it is cleared) */
  derelictDays: 90,
  /** PROPOSED until road wear lands (the Ponzi pass): years for an untouched road to read as fully worn */
  roadWearYears: 22,

  // ---- where a trip goes (src/agents/traffic.ts whereTo())
  /**
   * PROPOSED, and OFF (choices: 1). choices: how many jobs or shops come to mind for a household's trip (1 = the first, at
   * random, exactly as it was before the drive counted: the same trips, the same dice). power: how hard a shorter drive
   * pulls (0 = not at all; 2 = a drive half as long is four times as likely). floorSecs: seconds added to every drive, so
   * two places a block apart are not ten to one.
   * Measured with choices 3 on the reference town (scripts/onemorelane.mjs, CHOICES=3, seeds 1 to 3): two thirds of the
   * household trips that weighed three places went somewhere other than the first, and the widened road still did not fill
   * again (fullest in 78 weeks 25 to 31% against 38 to 47% before). It stays off until the traffic work has a town where it
   * can be shown to matter: docs/aaa/LOG_FABLE.md, "What induced demand needs".
   */
  whereTo: { choices: 1, power: 2, floorSecs: 20 },

  // ---- ONE MORE LANE, remembered (src/sim/widening.ts: it watches the traffic and changes nothing)
  /**
   * PROPOSED. weeks: how long a widening is followed, one reading a week: the design's "it always works for about 18
   * months" (78 weeks). minBefore: how full a road must have been for "traffic is back" to mean anything (a third full).
   * minWeeks: no "back to normal" in the first month, while the cars the works cleared off the road are still returning.
   * peakDays: a road's "busiest lately" is the most it filled in this stretch of days and the one before: 144, one turn of
   * the day-and-night clock, so it always holds at least one whole day's rush hours.
   */
  widening: { weeks: 78, minBefore: 0.33, minWeeks: 4, peakDays: 144 },

  // ---- world events (what the look and the sound are told; nothing in the simulation reads these)
  /** PROPOSED: the crashed cars' speeds added up (m/s) at which a crash reads as a full wreck: two cars at a Freedom Stroad's 20 m/s */
  crashWreckSpeed: 40,
  /**
   * PROPOSED: a disaster's reach (m) and strength 0..1 as the look is told them. A hurricane takes low ground anywhere
   * (the whole county from its middle: half the map's diagonal); a wildfire front burns 35 m round (disasters.ts fireStep);
   * a landslide is one road's mud pile; Florida Man is one blocked street.
   */
  disasterLook: {
    hurricane: { radius: 4345, intensity: 1 },
    wildfire: { radius: 35, intensity: 0.8 },
    landslide: { radius: 30, intensity: 0.6 },
    floridaMan: { radius: 40, intensity: 0.2 },
  },
};
