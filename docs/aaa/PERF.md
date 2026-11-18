# Graphics performance

## Startup readback and final production build at 8bc9025

The startup and quality-change check samples up to 25 pixels for a black frame. Each read asks the GPU for a result synchronously. Commit `8bc9025` returns on the first visibly lit pixel. Across 16 Low samples per version on the RTX 5090, median time on a lit town frame fell from 41.55 to 2.40 ms. With the GPU already finished it fell from 42.60 to 2.05 ms. All 25 first-lit positions, the threshold, both black-frame fallbacks and context loss produced the same decisions across 29 cases.

The first final-production phone run recorded 36.7 ms median and 127.7 ms p95. The strict p95 requirement is below 16 ms. Host CPU use ranged from 82.0% to 98.4%, with a 91.2% median during this run. The 300 intervals contained a median 119 draw calls and 533,587 triangles. The test completed with zero page errors. [Hardware report](measurements/phone-8bc9025-production.json)

The final source reproduced every numeric result from the six forest measurements and the 32 original overviews below. All 15 pre-push smoke tests passed. The 12,359,933-byte single-file release passed 32 production checks on desktop and touch. With networking disabled, a saved 969-resident town with 143 buildings and 128 roads reloaded with matching simulation fingerprints.

## Corrected integration at dae9c68

The Low phone target is a frame interval below 16 ms at the 95th percentile. The released HTML files ran consecutively on the RTX 5090 with the original 4× CPU throttle, current 969-resident town, seed 271828, 390 × 844 touch viewport and 300 measured intervals. Both runs completed with zero page errors.

| Production HTML | Frame median | Frame p95 | Median draws | Median triangles | Median host CPU use |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous, `149b543` | 19.5 ms | 40.9 ms | 119 | 553,505 | 47.2% |
| Corrected, `dae9c68` | 21.6 ms | 44.0 ms | 119 | 533,719 | 62.3% |

The corrected build missed the limit by 28.0 ms. Its first development run measured 52.6 ms p95 at 90.4% median host CPU use. These are desktop phone-proxy timings. Physical-phone timings remain unmeasured. [Previous production run](measurements/phone-149b543-paired-dae9c68.json) · [Corrected production run](measurements/phone-dae9c68-production.json)

Forest brightness variation fell 46.58–55.20% in the six original noon views and 43.50–56.65% after matching mean brightness. Each view also passed its original draw and triangle ceilings. With the sun near the horizon, the distant canopy now uses more of its ordinary sky and shadow lighting. All 36 reference-town lighting comparisons passed. At dusk the overview mean luminance measured 0.294 on High, 0.320 on Medium and 0.318 on Low. [Six fixed-mask measurements](measurements/forest-dae9c68.json)

All 32 original overview cameras submitted at least 30% fewer whole-scene triangles on the fourth frame and after terrain detail settled. The closest was High Block in rain, falling from 1,419,559 to 983,679 on frame four (30.71%) and from 1,559,079 to 1,017,215 after settling (34.76%). Run `node scripts/look/overview-budget.mjs --check docs/aaa/measurements/overview-dae9c68.json` to verify all 64 counts. [Hardware measurements](measurements/overview-dae9c68.json)

## Low phone frame time at 149b543, November 17

The enforced RTX 5090 phone proxy requires the 95th percentile of 300 consecutive frame intervals to be **below 16 ms**. It runs the 969-resident town with four-times CPU throttling, a 390 × 844 touch viewport, device pixel ratio 3 and a 585 × 1266 drawing buffer. The previous source is `b1fb132` and the shipping source is `149b543`. The controls use identical town data, camera, seed 271828 and game speed. Each run reported zero page errors.

| Run | Previous frame median / p95 | Shipping frame median / p95 |
| --- | ---: | ---: |
| First pair on the busier host | 34.1 / 78.7 ms | 10.6 / 33.1 ms |
| Second pair on the busier host | 15.4 / 47.2 ms | 16.8 / 61.3 ms |
| First pair under lighter load | 22.6 / 42.1 ms | 15.7 / 30.1 ms |
| Second pair under lighter load | 30.6 / 56.5 ms | 29.5 / 55.8 ms |
| Single-file production builds under lighter load | 20.9 / 39.6 ms | 16.6 / 34.6 ms |

Each development series ran in control, shipping, shipping, control order. Local graphics checks released their slots during both series. Other applications continued using the host. The shipping build consistently needed 119 median draws and about 554,000 triangles, compared with 211 draws and about 1.115 million triangles on the previous build. Both development repeats and the production check missed the frame-time target. Physical-phone timing remains unmeasured. [Previous production measurement](measurements/phone-027b18f-production.json) · [Shipping production measurement](measurements/phone-149b543-production.json)

In a separate 300-frame diagnostic under the lighter load, 59 of 64 frames containing a fixed simulation step and 70 of 236 frames without one reached 16 ms. All 15 slowest intervals included a step. Step duration alone had a p95 of 17.8 ms among the 64 step frames. Frames without a step had a p95 of 22.1 ms. The unchanged check can be repeated with `node scripts/look/phone.mjs --enforce`, `SCENES=reference`, `RATES=4` and the current town.

## Forest and whole-scene geometry, November 17

On shipping source `149b543`, all six original noon forest views pass the 40% reduction in masked brightness variation, both as measured and after equalizing the mean. The masks match the originals byte for byte. The original draw-call and triangle ceilings also pass in each view. At a camera height of 2 m a distant photo focus keeps the detailed tree shadows. The same camera above the trees uses species-specific silhouettes, with bare deciduous trees retaining their branch shadows in winter. [Six original and updated views](figures/forest-variation.jpg)

| Landscape | Low variation reduction | High variation reduction | Low / High after matching mean |
| --- | ---: | ---: | ---: |
| Appalachia | 52.4% | 46.6% | 54.6% / 43.5% |
| NorCal | 55.2% | 54.6% | 56.7% / 53.6% |
| Florida | 47.1% | 55.2% | 49.5% / 53.1% |

The archived whole-scene comparator is the original pre-W13 source `93ee555`, seed 1776. The populated Block uses the historical 781-resident fixture. Low and High each cover that town plus three landscapes at noon, golden hour, moonless night and in rain. All 32 views draw at least 30% fewer triangles on the original fourth frame and after terrain detail settles. The smallest fourth-frame reduction is High Block in rain, 1,419,559 to 990,162 (30.25%). The same comparison after settling is 1,559,079 to 1,023,698 (34.34%). Both 61-position zooms preserve all 262 buildings. At 1,600 m the reductions are 44.14% on Low and 35.34% on High.

The shipping game reproduced all 64 measured triangle counts from the initial graphics revision `5f6b94c`. [High Block, before and after in rain](figures/overview-rain-geometry.jpg)

On the 969-resident current town the road-edge mesh fell from 67,134 to 33,662 triangles. Across 403,184 bidirectional samples, the maximum surface displacement was 1.61 cm. The river keeps the original triangles wherever the flow texture can displace a vertex. Eighteen camera, surge, edited-bed and photo comparisons averaged 0.333 of 255 RGB levels of absolute change.

Run `node scripts/suite.mjs --only overview-budget --serve 5191 --gpu` to repeat all 32 cases on a frozen copy. The check reads the original counts from `scripts/look/overview-original.json` and requires the original viewport, camera, legacy Block population and building count. To check saved counts, use `node scripts/look/overview-budget.mjs --check <report.json>`. The unoptimized original fails all 32 comparisons.

## Final committed counter baseline

Revision `027b18f` passes all twelve paused reference views with zero counter violations. The run uses the committed 969-resident town, seed 271828, Chrome 157.0.8103.51 and NVIDIA RTX 5090 through ANGLE D3D11. Each row records the maximum over twelve frames.

| Preset / camera | Calls | Call limit | Triangles | Triangle limit |
|---|---:|---:|---:|---:|
| low/street | 245 | 250 | 1,165,277 | 1,223,541 |
| low/middle | 211 | 222 | 1,109,479 | 1,164,953 |
| low/overview | 191 | 201 | 1,092,282 | 1,146,897 |
| medium/street | 533 | 560 | 2,073,845 | 2,177,538 |
| medium/middle | 376 | 395 | 1,810,231 | 1,900,743 |
| medium/overview | 320 | 336 | 1,779,052 | 1,868,005 |
| high/street | 562 | 591 | 2,370,263 | 2,488,777 |
| high/middle | 403 | 424 | 2,165,494 | 2,273,769 |
| high/overview | 339 | 356 | 2,235,596 | 2,347,376 |
| ultra/street | 557 | 585 | 2,675,813 | 2,809,604 |
| ultra/middle | 433 | 455 | 2,403,533 | 2,523,710 |
| ultra/overview | 408 | 429 | 3,475,012 | 3,648,763 |

The per-view allowance remains 5%, rounded up, with absolute call ceilings of 250 on Low and 600 on High. Low street uses 245 calls and has five calls of absolute headroom. The fixture SHA-256 is `a3aa48b02a0ed6f692235b948f4149a3f9c2d75a003abc05acb74e437008f8d9` and the loaded-town fingerprint is `f74d7be`. The saved report is `shots/perf/final-027b18f/counters.json`.

The integration suite was active during the paused counter measurements.

## Reference-town timing on `027b18f`

On November 17, 2026, High 1080p passed its 8 ms frame p95 target. The Low phone proxy exceeded its 16 ms target by 9.1 ms. Ultra 4K recorded a 12.7 ms frame p95 without a specified target.

| Preset and buffer | Frame p50 / p95 (ms) | CPU work p50 / p95 (ms) | GPU p50 / p95 (ms) | Median draws | Median triangles |
|---|---:|---:|---:|---:|---:|
| High 1920×1080 | 4.5 / 6.9 | 4.4 / 6.8 | 4.94 / 7.27 | 403 | 2,177,330 |
| Ultra 3840×2160 | 6.0 / 12.7 | 5.8 / 12.6 | 5.97 / 7.96 | 433 | 2,415,552 |
| Low 585×1266, 4× CPU | 14.7 / 25.1 | 14.2 / 24.0 | 13.77 / 20.13 | 211 | 1,114,927 |

Each case warmed up for five seconds before 300 unpaced animation-frame intervals. CPU work measures the synchronous game-frame call. A separate 12-frame GPU timer-query sample measured elapsed rendering-pass spans, which can include gaps in CPU command submission under throttling. They do not isolate active GPU execution time or attribute an individual slow frame to CPU or GPU work. Desktop used DPR 1. Chrome emulated a 390×844 touch viewport at DPR 3 and 4× CPU throttling for Low. The game rendered to a 585×1266 buffer on the RTX 5090. Physical phone performance remains unmeasured.

The three runs used Chrome 157.0.8103.79, NVIDIA driver 610.60 and `ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Each loaded reference town `f74d7be`, seed 271828, at the middle camera, with zero page errors. Tests ran sequentially after the other test suites and golden captures finished. Desktop applications remained active.

| Sample boundary (CST) | CPU busy | GPU busy | VRAM used of 32,607 MiB | RAM available of 61.61 GiB |
|---|---:|---:|---:|---:|
| 16:02:48 before High | 24.5% | 15% | 4,233 MiB | 35.65 GiB |
| 16:03:37 after High, before Ultra | 21.3% | 10% | 3,076 MiB | 37.73 GiB |
| 16:04:20 after Ultra, before Low | 41.9% | 7% | 3,435 MiB | 36.50 GiB |
| 16:05:07 after Low | 17.7% | 22% | 1,974 MiB | 40.00 GiB |

CPU utilization covers one second at each boundary. GPU and memory figures are point samples. Chrome processes led CPU use in a short sample after Low. Both synchronous CPU work and the separate GPU p95 exceeded 16 ms in that case. These measurements leave the cause of the slowest intervals unresolved.

A separate CPU profile used the same 300-frame Low workload. Of 7,393 sampled stacks, 76.2% included the Three renderer, 39.4% direct draw submission and 25.3% shadow rendering. These inclusive categories overlap. All fifteen slowest instrumented frames ran a fixed simulation step; 64 of 300 frames stepped overall. Recurring vehicle presentation selection appeared in only 0.4% of stacks. Profiling raised synchronous p95 to 51.7 ms, so its absolute timings are diagnostic and do not replace the original 25.1 ms acceptance result. The delivered `Performance/Low-phone-CPU-profile.md`, CPU profile and per-frame records preserve the evidence. Fixed-step traffic and daily simulation work require a play-lane follow-up.

An isolated duplicate-shadow-LOD candidate was rejected. It reduced selection calls from four to two on Low and six to two on High/Ultra across the two building batches, while preserving actual shadow refreshes. All eighteen ordinary rendering cases matched pixels exactly, and all twenty-one cases retained geometry, per-light draw lists and simulation state. Direct photo captures varied across repeated controls, leaving export equivalence unverified. No timing benefit was measured and no candidate source entered the branch. The original Low acceptance result remains 25.1 ms. The delivered `Performance/Rejected-shadow-detail-review.md` and per-case JSON retain the experiment.

## Earlier baseline measurements

Measured 2026-11-17 on the frozen `232272c` baseline. Chrome 157.0.8103.51 reported `ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Seed 271828. This machine also ran other graphics checks during capture. Re-run a case in isolation to investigate a tail-latency change.

Every row uses five seconds of warm-up followed by 300 unpaced animation-frame intervals. The simulation advances by 1/60 s per measured frame at 1× speed. Desktop uses DPR 1. The reference town uses the middle camera. Map overviews use a fixed 1,050 m camera relative to the start, in clear weather at 12:30. Times are milliseconds. Frame p95 includes scheduling and GPU backpressure. CPU work covers the synchronous call to the game frame.

## Desktop

32 of 32 requested desktop cases measured.

| Scene | Preset | Viewport | CPU | Frame p50 | Frame p95 | CPU work p50 | GPU p50 | Calls p50 | Triangles p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reference town | low | 1920×1080 | 1× | 2.50 | 52.30 | 2.40 | 4.36 | 165 | 1,032,664 |
| Reference town | low | 2560×1440 | 1× | 2.40 | 28.30 | 2.30 | 2.57 | 165 | 1,032,665 |
| Reference town | medium | 1920×1080 | 1× | 3.10 | 12.70 | 2.90 | 2.88 | 227 | 1,183,820 |
| Reference town | medium | 2560×1440 | 1× | 4.30 | 37.40 | 4.00 | 3.05 | 227 | 1,183,296 |
| Reference town | high | 1920×1080 | 1× | 4.90 | 30.40 | 4.60 | 4.48 | 398 | 2,427,111 |
| Reference town | high | 2560×1440 | 1× | 4.60 | 92.40 | 4.40 | 4.12 | 398 | 2,426,894 |
| Reference town | ultra | 1920×1080 | 1× | 5.50 | 27.90 | 5.30 | 5.18 | 401 | 2,589,539 |
| Reference town | ultra | 2560×1440 | 1× | 5.30 | 34.10 | 5.00 | 4.86 | 404 | 2,594,634 |
| Holler County | low | 1920×1080 | 1× | 1.20 | 1.70 | 1.00 | 1.32 | 108 | 661,621 |
| Holler County | low | 2560×1440 | 1× | 1.60 | 4.70 | 1.30 | 1.59 | 108 | 661,621 |
| Holler County | medium | 1920×1080 | 1× | 1.90 | 6.40 | 1.60 | 6.17 | 125 | 852,206 |
| Holler County | medium | 2560×1440 | 1× | 1.60 | 3.70 | 1.40 | 3.65 | 125 | 852,206 |
| Holler County | high | 1920×1080 | 1× | 3.10 | 8.50 | 2.80 | 6.69 | 233 | 2,114,697 |
| Holler County | high | 2560×1440 | 1× | 2.20 | 3.50 | 2.10 | 3.85 | 233 | 2,114,697 |
| Holler County | ultra | 1920×1080 | 1× | 2.60 | 4.20 | 2.30 | 3.09 | 260 | 5,445,631 |
| Holler County | ultra | 2560×1440 | 1× | 2.80 | 5.10 | 2.50 | 3.76 | 260 | 5,445,631 |
| Golden Coast | low | 1920×1080 | 1× | 1.40 | 3.40 | 1.20 | 0.64 | 125 | 676,912 |
| Golden Coast | low | 2560×1440 | 1× | 1.40 | 2.60 | 1.20 | 1.39 | 125 | 676,912 |
| Golden Coast | medium | 1920×1080 | 1× | 2.50 | 15.80 | 2.10 | 1.58 | 140 | 757,565 |
| Golden Coast | medium | 2560×1440 | 1× | 1.80 | 6.20 | 1.60 | 1.17 | 140 | 757,565 |
| Golden Coast | high | 1920×1080 | 1× | 1.70 | 2.90 | 1.40 | 1.59 | 145 | 972,888 |
| Golden Coast | high | 2560×1440 | 1× | 1.90 | 4.60 | 1.60 | 1.39 | 145 | 972,888 |
| Golden Coast | ultra | 1920×1080 | 1× | 1.60 | 2.70 | 1.40 | 1.25 | 169 | 1,308,328 |
| Golden Coast | ultra | 2560×1440 | 1× | 1.60 | 2.70 | 1.40 | 1.46 | 169 | 1,308,328 |
| Gator Gulch | low | 1920×1080 | 1× | 1.40 | 2.80 | 1.10 | 1.08 | 81 | 558,054 |
| Gator Gulch | low | 2560×1440 | 1× | 1.30 | 2.30 | 1.00 | 0.84 | 81 | 558,054 |
| Gator Gulch | medium | 1920×1080 | 1× | 2.20 | 14.40 | 1.80 | 1.89 | 96 | 609,945 |
| Gator Gulch | medium | 2560×1440 | 1× | 1.90 | 5.90 | 1.60 | 1.07 | 96 | 609,945 |
| Gator Gulch | high | 1920×1080 | 1× | 2.40 | 5.90 | 2.10 | 1.60 | 169 | 1,537,472 |
| Gator Gulch | high | 2560×1440 | 1× | 2.40 | 4.70 | 2.20 | 1.59 | 169 | 1,537,472 |
| Gator Gulch | ultra | 1920×1080 | 1× | 2.50 | 3.80 | 2.20 | 2.49 | 227 | 3,006,304 |
| Gator Gulch | ultra | 2560×1440 | 1× | 2.10 | 3.30 | 1.90 | 2.02 | 227 | 3,006,304 |

## Phone proxy

390×844 CSS pixels, DPR 3, touch enabled, Low preset and Chrome DevTools CPU throttling at 4× or 6×. Measured WebGL buffer 585×1266. The proxy measures CPU throttling on the RTX 5090. Phone GPU throughput, memory bandwidth, thermals and touch latency require the owner’s phone.

8 of 8 requested phone cases measured.

| Scene | Preset | Viewport | CPU | Frame p50 | Frame p95 | CPU work p50 | GPU p50 | Calls p50 | Triangles p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reference town | low | 390×844 | 4× | 5.20 | 50.80 | 4.90 | 5.13 | 139 | 826,007 |
| Reference town | low | 390×844 | 6× | 129.90 | 864.00 | 121.10 | 29.25 | 139 | 827,142 |
| Holler County | low | 390×844 | 4× | 7.70 | 13.00 | 7.10 | 7.63 | 72 | 502,303 |
| Holler County | low | 390×844 | 6× | 15.60 | 28.00 | 14.30 | 18.14 | 72 | 502,303 |
| Golden Coast | low | 390×844 | 4× | 5.70 | 10.30 | 5.20 | 7.11 | 87 | 519,493 |
| Golden Coast | low | 390×844 | 6× | 11.60 | 21.90 | 10.60 | 7.38 | 87 | 519,493 |
| Gator Gulch | low | 390×844 | 4× | 6.10 | 9.90 | 5.40 | 4.88 | 66 | 418,248 |
| Gator Gulch | low | 390×844 | 6× | 9.90 | 18.40 | 9.10 | 8.83 | 66 | 418,248 |

## Reference-town repeat

The hardware reference town fingerprint was `efb73eb5`. On a second run, High at 1920×1080 measured 3.9/7.3 ms frame p50/p95 and 4.38 ms median GPU time. The 4× Low proxy measured 55.1/685.8 ms and 84.18 ms median GPU time. A two-second host CPU sample around this repeat measured 99% utilization across 32 logical CPUs, with 6.3 GiB free of 61.6 GiB RAM. The spread prevents certification of an isolated time budget from these runs. Reports from the second run are under `shots/perf/quiet/`.

## Draw-call and triangle gate

The fixed reference save has SHA-256 `51ed9258a3ddc5d276ad66d8404a38eb11eaf0d41f6ec3b8ca176d9a0fde0fe5`. The gate pauses the simulation and measures maximum calls and triangles over 12 frames per camera. It bounds each of the twelve cases at 5% above its measured peak, rounded up. Low also has a 250-call ceiling and High has a 600-call ceiling. The baseline passed all twelve. Changing Low/street to 163 calls against its 162-call budget returned exit 1. Hardware frame p95 is reported separately as a warning. Run `node scripts/look/budget.mjs` against the frozen game, or use `--check <saved counters.json>` to replay the numerical comparison.

A live deliberate regression inserted 64 separate nonculled meshes into the frozen scene. The gate rejected all twelve cases. Low street rose from 154 to 218 calls, against its 162-call limit. The test returned exit 1. These meshes were injected only in the scratch measurement server. The reference build passed the second independent run with zero counter violations.

## Low street furniture

The reduced civic layer keeps 64 of the reference town’s 142 placements and retains every bus shelter. It draws vertex-coloured LOD2 geometry within 245 m, using camera-frustum culling and zero civic texture requests. In the Low noon golden camera, the frame changed from 141 calls and 587,533 triangles to 148 calls and 591,584 triangles. Fourteen prop instances were visible in six civic draws. In the fixed twelve-camera budget run, the Low street peak changed from 154 calls and 616,393 triangles to 160 calls and 620,683 triangles. Every case stayed within the original thresholds.

The W7 reference-town 4× proxy measured 27.0/63.5 ms frame p50/p95 and the 6× proxy measured 43.9/110.4 ms under shared-machine load. The time budget remains open. The fixed-camera before/after sheet is `docs/aaa/figures/civic-low.jpg`. All twelve civic assertions passed, including live Low/High transitions and a cold Low load. Three new Low assertions fail on the original build with the same seed.

## GPU pass timings

Median milliseconds across a separate 12-frame sample, collected with `EXT_disjoint_timer_query_webgl2`. Pass labels follow `scripts/nightcost.mjs`. Shadow work is timed separately within the scene. Dashes indicate an absent pass. Intermittent passes may round to zero and medians need not sum to the full-frame median. Individual reports also include p95 and peak per pass.

| Scene | Preset | Viewport | CPU | scene | shadow map | water mirror | ao | ao blur | composite | bloom | grade | people pose | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reference town | low | 1920×1080 | 1× | 2.99 | 0.69 | — | — | — | — | — | — | 0.02 | 0.00 |
| Reference town | low | 2560×1440 | 1× | 1.20 | 0.06 | — | — | — | — | — | — | 0.01 | 0.00 |
| Reference town | medium | 1920×1080 | 1× | 2.21 | 0.54 | — | — | — | 0.01 | 0.05 | 0.02 | 0.01 | 0.00 |
| Reference town | medium | 2560×1440 | 1× | 2.68 | 0.62 | — | — | — | 0.03 | 0.09 | 0.03 | 0.01 | 0.00 |
| Reference town | high | 1920×1080 | 1× | 1.42 | 0.91 | 1.76 | 0.01 | 0.01 | 0.01 | 0.05 | 0.02 | 0.01 | 0.00 |
| Reference town | high | 2560×1440 | 1× | 1.84 | 0.73 | 0.86 | 0.02 | 0.02 | 0.03 | 0.08 | 0.03 | 0.01 | 0.00 |
| Reference town | ultra | 1920×1080 | 1× | 1.67 | 0.80 | 2.00 | 0.04 | 0.04 | 0.01 | 0.11 | 0.02 | 0.01 | 0.00 |
| Reference town | ultra | 2560×1440 | 1× | 2.08 | 0.77 | 1.43 | 0.08 | 0.07 | 0.04 | 0.08 | 0.03 | 0.01 | 0.00 |
| Holler County | low | 1920×1080 | 1× | 0.74 | 0.11 | — | — | — | — | — | — | — | 0.00 |
| Holler County | low | 2560×1440 | 1× | 1.57 | 0.02 | — | — | — | — | — | — | — | 0.00 |
| Holler County | medium | 1920×1080 | 1× | 5.23 | 0.34 | — | — | — | 0.01 | 0.04 | 0.01 | — | 0.00 |
| Holler County | medium | 2560×1440 | 1× | 3.20 | 0.02 | — | — | — | 0.02 | 0.07 | 0.03 | — | 0.00 |
| Holler County | high | 1920×1080 | 1× | 2.12 | 0.02 | 3.19 | 0.01 | 0.01 | 0.01 | 0.04 | 0.01 | — | 0.00 |
| Holler County | high | 2560×1440 | 1× | 2.16 | 0.03 | 1.44 | 0.02 | 0.02 | 0.02 | 0.07 | 0.03 | — | 0.00 |
| Holler County | ultra | 1920×1080 | 1× | 1.53 | 0.18 | 0.96 | 0.04 | 0.04 | 0.01 | 0.05 | 0.02 | — | 0.00 |
| Holler County | ultra | 2560×1440 | 1× | 1.88 | 0.19 | 1.00 | 0.06 | 0.06 | 0.03 | 0.05 | 0.01 | — | 0.00 |
| Golden Coast | low | 1920×1080 | 1× | 0.46 | 0.02 | — | — | — | — | — | — | — | 0.00 |
| Golden Coast | low | 2560×1440 | 1× | 0.88 | 0.03 | — | — | — | — | — | — | — | 0.00 |
| Golden Coast | medium | 1920×1080 | 1× | 1.00 | 0.24 | — | — | — | 0.01 | 0.05 | 0.02 | — | 0.00 |
| Golden Coast | medium | 2560×1440 | 1× | 0.92 | 0.02 | — | — | — | 0.02 | 0.06 | 0.03 | — | 0.00 |
| Golden Coast | high | 1920×1080 | 1× | 1.04 | 0.38 | 0.00 | 0.01 | 0.01 | 0.01 | 0.05 | 0.02 | — | 0.00 |
| Golden Coast | high | 2560×1440 | 1× | 1.06 | 0.03 | 0.00 | 0.02 | 0.02 | 0.02 | 0.07 | 0.03 | — | 0.00 |
| Golden Coast | ultra | 1920×1080 | 1× | 0.84 | 0.06 | 0.00 | 0.04 | 0.04 | 0.01 | 0.05 | 0.02 | — | 0.00 |
| Golden Coast | ultra | 2560×1440 | 1× | 1.13 | 0.06 | 0.00 | 0.08 | 0.06 | 0.02 | 0.07 | 0.03 | — | 0.00 |
| Gator Gulch | low | 1920×1080 | 1× | 0.64 | 0.15 | — | — | — | — | — | — | — | 0.00 |
| Gator Gulch | low | 2560×1440 | 1× | 0.74 | 0.01 | — | — | — | — | — | — | — | 0.00 |
| Gator Gulch | medium | 1920×1080 | 1× | 1.52 | 0.24 | — | — | — | 0.01 | 0.04 | 0.01 | — | 0.00 |
| Gator Gulch | medium | 2560×1440 | 1× | 0.87 | 0.02 | — | — | — | 0.02 | 0.05 | 0.01 | — | 0.00 |
| Gator Gulch | high | 1920×1080 | 1× | 1.05 | 0.02 | 0.31 | 0.01 | 0.01 | 0.01 | 0.05 | 0.02 | — | 0.00 |
| Gator Gulch | high | 2560×1440 | 1× | 1.05 | 0.02 | 0.35 | 0.02 | 0.02 | 0.02 | 0.05 | 0.01 | — | 0.00 |
| Gator Gulch | ultra | 1920×1080 | 1× | 1.15 | 0.32 | 0.41 | 0.04 | 0.04 | 0.01 | 0.04 | 0.01 | — | 0.00 |
| Gator Gulch | ultra | 2560×1440 | 1× | 1.03 | 0.09 | 0.52 | 0.06 | 0.06 | 0.02 | 0.05 | 0.01 | — | 0.00 |
| Reference town | low | 390×844 | 4× | 3.80 | 0.63 | — | — | — | — | — | — | 0.01 | 0.00 |
| Reference town | low | 390×844 | 6× | 25.86 | 0.72 | — | — | — | — | — | — | 0.02 | 0.00 |
| Holler County | low | 390×844 | 4× | 6.80 | 0.74 | — | — | — | — | — | — | — | 0.00 |
| Holler County | low | 390×844 | 6× | 15.90 | 1.29 | — | — | — | — | — | — | — | 0.00 |
| Golden Coast | low | 390×844 | 4× | 6.69 | 0.41 | — | — | — | — | — | — | — | 0.00 |
| Golden Coast | low | 390×844 | 6× | 6.84 | 0.65 | — | — | — | — | — | — | — | 0.00 |
| Gator Gulch | low | 390×844 | 4× | 4.00 | 0.14 | — | — | — | — | — | — | — | 0.00 |
| Gator Gulch | low | 390×844 | 6× | 7.50 | 0.53 | — | — | — | — | — | — | — | 0.00 |

## Ultra forest and water reflection

On the Holler County overview at 2560×1440, the scene was the largest rendering pass. A separate RTX 5090 test alternated forest visible, hidden, hidden, visible with 24 GPU-timed frames per sample. Hiding trees reduced submitted triangles from 5,445,631 to 1,731,657 and draws from 260 to 223. With trees visible, median scene time was 1.93–2.40 ms and water mirror time was 0.98–1.38 ms. With trees hidden, they measured 1.46–1.49 ms and 0.28–0.29 ms respectively. A lower-detail treeline in the reflection is a candidate for the next timed A/B that preserves full forest detail in the main view. Raw results are in `shots/perf/ultra-forest-diagnostic.json`.

## Replay

From the repository root, point `BASE_URL` at a frozen server and `CHROME` at the hardware-capable Chrome executable. Run `node scripts/look/gpu.mjs` and `node scripts/look/phone.mjs`. The renderer check rejects software adapters. Use comma-separated `PRESETS`, `SIZES`, `SCENES` and `RATES` to repeat selected cases. The runners save raw JSON after each case under `shots/perf/look/`.

Append `--enforce` to fail a measured reference High 1080p p95 at or above 8 ms, or a reference Low 4× p95 at or above 16 ms. The target case must be included in the selected matrix. Use `node scripts/look/gpu.mjs --check <report.json>` or the corresponding `phone.mjs` command to enforce a previously saved hardware result. This checker returned exit 0 on the 7.3 ms High repeat, exit 1 on the original 30.4 ms High result, and exit 1 on the 63.5 ms W7 phone result. Both runners stay in the measure tier.
