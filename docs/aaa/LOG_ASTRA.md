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

## Camera and photo milestone, 2026-11-17

The camera changes were measured on fixed Holler County overview poses with seed 1776. The original view came from the frozen 232272c tree. Camera-only comparisons used a frozen tree based on 694752c. Follow tests used the merged ViewTarget contract from effaa9e. The changes leave default tilt-shift off. Low keeps its direct rendering path, with zero depth-blur passes.

| Measurement | Original | Updated |
| --- | --- | --- |
| Maximum inward zoom step at 60 Hz | 3.302% of distance | 1.762% |
| Maximum outward zoom step at 60 Hz | 4.299% | 1.794% |
| Maximum 3D camera travel per frame, Low | 4.299% | 1.573% |
| Maximum 3D camera travel per frame, High | 4.299% | 1.670% |
| Worst cursor drift, Low | 41.203 CSS px | 0.328 CSS px |
| Worst cursor drift, High | 78.886 CSS px | 0.257 CSS px |
| Initial Low calls / triangles | 72 / 380,086 | 72 / 380,086 |
| Initial High calls / triangles | 142 / 1,069,761 | 142 / 1,069,761 |

`scripts/look/camera-zoom.mjs` writes all 61 pose samples, with optional per-frame captures. Before/after sheets at `shots/look/camera/low-comparison.jpg` and `high-comparison.jpg` were opened and reviewed. Both settle to within 0.006% of the target distance in one second. Pitch changes by 0.0449 radians per tested wheel notch and preserves the player's chosen angle.

`scripts/look/depth-focus.mjs` places stripe panels on the same image row at different depths. The original band blur failed to distinguish them. The new shader retained 99.99% focused edge contrast and reduced defocused edge contrast to 20.7–22.0%. At street distance it retained 99.99%. The overview comparison at `shots/look/focus/after/overview.jpg` was opened. The owner still decides the default strength.

`gesturetest`, `edgetest`, `tiptest` and `fovtest` at all four FOVs on phone and desktop passed. The first gesture attempt caught a stalled two-finger pan goal. Updating the goal immediately corrected it, and the rerun passed. The sampler script passed 19 checks again with the merged slot-aware browser harness.

The contract-driven chase camera followed a sedan and city bus over 4.87 metres each and a person over 2.4 metres. All remained in frame, with camera pitch 0.152–0.224 radians and terrain clearance 2.79–6.03 metres. Manual input releases the rig, and a vanished subject releases it. The three images under `shots/look/follow/` were opened.

Photo mode uses a separate free camera, hides the HUD, freezes simulation stepping and supports street height, FOV, focus, time and weather previews. The existing orbit camera and simulation values survived every tested session. The postcard art uses bundled Bungee and Yellowtail fonts and the approved cream, ink, lime and Cannon red palette. Six native PNG exports passed on all three maps, at 585×1266 on Low and 1280×720 on High. The two county contact sheets are `shots/look/postcards/low.jpg` and `high.jpg`, both reviewed.

The explicit 3840×2160 export used NVIDIA GeForce RTX 5090 through ANGLE D3D11, Chrome 157.0.8103.51. The HDR render target measured 3840×2160 during capture. The resulting image differed from a 3× upscale by 2.956 RGB levels per channel on average. Normal completion and an injected draw failure restored the original 1280×720 buffer, pixel ratio, camera aspect and post targets. The full PNG is `shots/look/postcards/4k/holler-county.png` at 10,054,060 bytes.

`ipcheck` reported zero new fix items. Its three existing colour-review findings remain. The scoped postcard content audit found one line, the brief's "Greetings from", with no TypeSafe key available. It made zero requests, used zero tokens and cost $0. This line remains unjudged by the automated audit.

Remaining camera work is HUD wiring, Then & Now, and owner review of the optional depth-blur default. Inspector, Settings and photo API wiring are specified in REQUESTS_ASTRA.md. Owner checks are one-finger look, two-finger movement, street height, exit restoration and PNG saving on the actual phone.

## RTX hardware and renderer milestone, 2026-11-17

Branch `codex/aaa-world`, integration merged through `effaa9e`. Published work through this milestone includes hardware tooling, Low civic furniture, camera and photo APIs, packed-normal correction and the people LOD hook. Every source commit was checked in a separate staged-only checkout with `npm run gate`.

The 5090 completed 32 desktop and eight CPU-throttled phone-proxy cases. The baseline and per-pass tables are in PERF.md. Hardware strings are verified before accepting timings. Strict replay accepts the High reference repeat at 7.3 ms p95 and rejects the earlier 30.4 ms run. The Low town time target remains open. The latest civic 4× proxy measured 27.0 ms median and 63.5 ms p95 while other work shared the host. No physical phone was measured. Injecting 64 meshes failed all twelve fixed-camera draw budgets. The original and reduced-civic versions passed those same limits.

Low now draws reduced civic furniture. At the reference junction the visible count rises from zero to fourteen objects, with zero material-texture requests. Across the town it keeps all shelters. The twelve-camera budget passes. The comparison is `docs/aaa/figures/civic-low.jpg`.

The packed civic-normal fix corrected 102,284 wrong vectors among 103,680 vertices and 166 incorrect attribute lengths to zero. The reviewed comparison is `docs/aaa/figures/civic-normal-stride.jpg`. People detail now updates in Game.frame and scales with FOV. Twelve preset/FOV cases preserve each simulated citizen, with zero render-list gaps or duplicates. Existing lineup and foot-placement checks pass. Further night measurements are recorded in W15.md as those changes land.

The drawn HUD library provides 115 original icons mapped to 158 control IDs. A Chromium raster check passed all 630 status comparisons across sizes, themes and colour-vision simulations, including colour-free shapes. It rejects an intentionally duplicated status glyph. Reviewed sheets are `docs/screenshots/aaa/hud-icons.png` and `hud-statuses.png`. FABLE owns wiring these icons into controls. The dry content scanner classified SVG geometry as prose, recorded in REQUESTS_ASTRA.md.

### Work still in progress

Forest experiments retain their source snapshots and measurements. One trial reduced the numerical contrast but made the crowns pale and flat on inspection. It was rejected. The first facade-material trial gained only 0.2–2.7% normalized edge energy against the requested 25%, so it also remains experimental. Further material and forest work is outside the shipping commits at this milestone.

Road continuity, skyline silhouettes and night fixtures have separate tests and are being reviewed for their own commits. Remaining work includes shadow cascades, Low grading, water and atmosphere, construction/disaster effects, info views, vegetation details, building LOD, the camera-priority traffic contract, Then & Now and the audio phase. The reproducible phone folder and audio listening files will be added with their validation results.

The owner’s sample full-resolution postcard is copied into this chat’s outputs as `Holler County - 4K postcard.png`. Inspect tree silhouettes, water edges and the lettering at native size. The built-in export defaults to the current render buffer. The requested 4K size is explicit.
