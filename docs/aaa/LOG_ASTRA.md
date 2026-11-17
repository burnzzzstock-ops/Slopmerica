# World and sound work log

## 2026-11-17 · Windows baseline and phone quality

Branch `codex/aaa-world`. Started from `aaa/briefs` at `232272c`. Latest integration merged for this milestone is `0d7e4d2`. FABLE has its own worktree and owns integration.

### What the player sees

Commit `694752c` applies the selected post-processing pipeline in the current city. On a 390 × 844 touch viewport at DPR 3 the original benchmark selected Low at 12 ms per frame and Medium at 30 ms. The same deterministic interval sequences now select Medium and Low respectively. The sampler gives shader warm-up a second and ignores suspended intervals. A manual choice remains selected. A Medium → Low → Medium switch renders the same city and WebGL context on each step. Geometry pool sizes take effect on the next load.

`scripts/look/preset-switch.mjs` passed 19/19 assertions on the patched frozen game and 9/19 on the original. TypeScript passed. These are controlled sampler inputs on desktop hardware. Actual GPU and proxy timings are tracked in PERF.md.

### Baseline checks

Frozen game `232272c`, Windows Chrome 157, seed 7331 where supported. The following scripts all exited 0. The early runs used scratch copies with only the browser path and shader source path adapted for Windows. The committed harness fixes are now merged.

| Check | Observed result |
| --- | --- |
| glcheck, nantest | Passed the GL draw and finite-value checks |
| aotest | High 150 m open-ground darkening 0.37/255, row spread 0.07 |
| nightglow | Close night street mean 92.5 versus 144.9 at noon, 0% blown white, 0% wide-view bright amber specks |
| treelod | Far/near tree luma ratios 0.91 at 140 m and 0.94 at 320 m on Golden Coast |
| impostortest | Phone and desktop billboard sheet checks passed |
| qualitytest | 232,790 reference trees on both presets, all 121 local counts equal, traffic budget 1,000 on both |
| shadercheck | No sin-based hashes in 162 source files |
| vehicletest | All 59 models passed |
| peoplestats | 69 archetypes, average 768.2 triangles near and 210 far |

The original suite also returned exit 0 for an empty selection, and the original shader check attempted to read a doubled Windows drive path. Integration commit `4acd751` fixed the shader check. Commit `18e87a3` guards an empty registry. A misspelled `--only` still produced “0 of 0 pass” with exit 0 after the merge and is recorded in the requests.

### Reproduce and continue

The isolated checkout is under this chat's `work/Slopmerica-astra`. Ports 5190–5199 belong to world and sound work. Run Node scripts from the checkout root. The starting revision is frozen on 5191. Raw initial baseline logs are in the sibling directory `frozen-232272c/shots/baseline/`. Single-feature measurement folders live under `shots/`. Keep source changes and golden updates in separate commits.

1. Finish the golden and hardware reference-town runs against FABLE's committed fixture.
2. Compare the forest canopy mask on all three overview cameras and both presets. Review the contact sheets before accepting a change.
3. Verify camera easing, Low civic furniture and the remaining visual items in brief order. Begin the audio phase halfway through the visual phase.

### Owner checks

- On the phone, open the same saved city, switch between Low and Medium in Settings, and verify that night lamps change bloom while the city and camera stay in place.
- Check the same forested ridge on each preset at noon and dusk, then approach at street height. Record the phone model, screen refresh rate and the first view that visibly stutters.
- Audio awaits the listening stage. I cannot audition the mix in this workflow. WAVs, loudness and clipping measurements will be logged together before requesting a listening pass.
