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

The repeatable harness in `scripts/perfTown.mjs` builds a dry 7 × 7 road grid, zones it, advances 270 simulation days, waits at least 20 seconds for dynamic resolution to settle, and collects 30 frame samples. Measurements below are from Chrome 153 using **ANGLE D3D11 on an AMD Radeon GPU** in the Ryzen AI 7 350 laptop, not SwiftShader. Both runs reached full preset resolution. Browser FPS is uncapped. The simulated towns vary slightly between runs because citizen and traffic events are random.

| Preset and viewport | Town | FPS | Mean frame | Work | Draw calls | Triangles | Resolution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| High, 1280 × 800 | 201 buildings, 8,083 people | 66.8 | 15.0 ms | 8.2 ms | 147 | 3,368,874 | 100% |
| Low, 390 × 844 | 184 buildings, 7,122 people | 129.5 | 7.7 ms | 4.1 ms | 111 | 1,134,400 | 100% |

![High preset F3 overlay](qa/town-high-overlay.jpg)
![Low preset F3 overlay on a phone-size viewport](qa/town-low-overlay.jpg)

Unobstructed game captures: [High town](qa/town-high.jpg) and [Low town](qa/town-low.jpg).

The measured scene costs addressed in this pass were:

1. A distant water tile caused a second scene render in a dry town view. Visibility and distance culling eliminated **186 draw calls and about 2.35 million triangles** in that comparison, while retaining planar reflections around nearby water. The final dry-town profile confirms that toggling reflection off saves no additional calls.
2. Ground-detail placement previously took 3.4 ms median and up to 9.3 ms in a dense town. The incremental refill now measured **0.6 ms median and 0.6 ms maximum** per frame in the final High and Low town runs.
3. Distant commune fires were adding point lights to the scene. Their light is now active only near the camera; distant flame and bulb geometry remains visible.
4. The building geometry kit now shares quad corners. The High town uses **188,646 stored building vertices** (201 buildings) and the Low town uses **163,508** (184 buildings), with the same rendered triangles and visual detail. A deterministic 10,800-building generation matrix measured a 32.8% drop in stored vertices.

`scripts/touchtest.mjs` passed at 390 × 844 on Low after the agents merge: the drag created four road segments, Done ended drawing, and Undo restored the original segment count. The departure test confirmed `gone` state, attached burnt remains, scorched terrain paint, and no browser errors. The final 36-view commune matrix and 21 additional close-water GL checks across all three maps had no console, shader, or WebGL draw errors. TypeScript and the single-file build passed before the branch push.
