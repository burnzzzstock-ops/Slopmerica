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

  // ---- world events (what the look and the sound are told; nothing in the simulation reads these)
  /** PROPOSED: the crashed cars' speeds added up (m/s) at which a crash reads as a full wreck: two cars at a Freedom Stroad's 20 m/s */
  crashWreckSpeed: 40,
};
