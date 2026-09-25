# AA world pass: visual QA and performance

The commune images compare the base commune rebuild (`f5a8dbe`) with this branch at the same Appalachia camp, camera distance, time, and weather. The final branch was also captured on NorCal and Florida at 15, 40, and 150 m in day, night, rain, and snow; all 36 final captures completed without browser, console, or shader errors.

| View | Before | After |
| --- | --- | --- |
| Day, 15 m | ![Before, day at 15 m](qa/commune-before-day-15.jpg) | ![After, day at 15 m](qa/commune-after-day-15.jpg) |
| Day, 40 m | ![Before, day at 40 m](qa/commune-before-day-40.jpg) | ![After, day at 40 m](qa/commune-after-day-40.jpg) |
| Day, 150 m | ![Before, day at 150 m](qa/commune-before-day-150.jpg) | ![After, day at 150 m](qa/commune-after-day-150.jpg) |
| Night, 40 m | ![Before, night at 40 m](qa/commune-before-night-40.jpg) | ![After, night at 40 m](qa/commune-after-night-40.jpg) |
| Rain, 40 m | ![Before, rain at 40 m](qa/commune-before-rain-40.jpg) | ![After, rain at 40 m](qa/commune-after-rain-40.jpg) |
| Snow, 40 m | ![Before, snow at 40 m](qa/commune-before-snow-40.jpg) | ![After, snow at 40 m](qa/commune-after-snow-40.jpg) |

Additional final views: [NorCal day](qa/norcal-after-day-40.jpg), [Florida night](qa/florida-after-night-40.jpg), [signalized street by day](qa/street-signal-day.jpg), [signalized street at night](qa/street-signal-night.jpg), and [commune remains after departure](qa/commune-burnt-remains.jpg).

## Large town performance

The repeatable harness in `scripts/perfTown.mjs` builds a dry 7 × 7 road grid, zones it, advances 270 simulation days, and waits 360 frames for dynamic resolution to settle before collecting 30 frame samples. Measurements below are from Chrome 153 using **ANGLE D3D11 on an AMD Radeon 860M** in the Ryzen AI 7 350 laptop, not SwiftShader. Browser FPS is uncapped. The simulated towns vary slightly between runs because citizen and traffic events are random.

| Preset and viewport | Town | FPS | Mean frame | Work | Draw calls | Triangles | Resolution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| High, 1280 × 800 | 198 buildings, 8,061 people | 62.8 | 15.9 ms | 15.4 ms | 294 | 3,743,518 | 93% |
| Low, 390 × 844 | 186 buildings, 7,068 people | 102.7 | 9.7 ms | 9.5 ms | 260 | 1,414,088 | 100% |

![High preset F3 overlay](qa/town-high-overlay.jpg)
![Low preset F3 overlay on a phone-size viewport](qa/town-low-overlay.jpg)

The measured scene costs addressed in this pass were:

1. A distant water tile caused a second scene render in a dry town view. Visibility and distance culling eliminated **186 draw calls and about 2.35 million triangles** there, while retaining planar reflections around nearby water.
2. Ground-detail placement previously took 3.4 ms median and up to 9.3 ms in a dense town. The incremental refill now measured **0.6 ms median and 0.7 ms maximum** per frame in the final High and Low town runs.
3. Distant commune fires were adding point lights to the scene. Their light is now active only near the camera; distant flame and bulb geometry remains visible.

`scripts/touchtest.mjs` passed at 390 × 844 on Low: the drag created four road segments, Done ended drawing, and Undo restored the original segment count. The departure test confirmed `gone` state, attached burnt remains, scorched terrain paint, and no browser errors. TypeScript and the single-file build passed before the branch push.
