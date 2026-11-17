# Graphics performance

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
