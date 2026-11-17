# Saved climate drives weather presentation

Weather presentation reads the saved climate on every frame. Kind, intensity, season, temperature, surface wetness, snow cover and wind come from `Game.climate`. The renderer retains cloud, fog, precipitation, lightning and grade easing. Its independent weather selection, spell clock, surface accumulation and gameplay-effect table are removed.

The Game binding supplies the source directly. Its public `weather.force(kind, days)` hook still accepts the existing 360-second sky-day duration. The owning Game callback converts that duration to calendar days, forces the source and refreshes it with two zero-time steps. The first step updates intensity. The second lets temperature read that refreshed intensity. Forcing first guarantees a positive expiry interval, so neither step crosses an automatic spell boundary. The unit test independently computes full-strength temperature from the public seasonal temperature and weather offset. It checks all ten weather kinds, three maps and three durations, including the minimum duration.

Paused overrides retain existing wetness and snow. Rain increases wetness as fixed simulation steps advance. `settle()` applies the current source values immediately. It also settles the visual cloud, fog and surface responses. The source random stream, wind angle, saved surface values and time bounds remain unchanged during zero-time refreshes.

Atmosphere Lab owns a seeded Climate instance and advances it with the Lab calendar. Its controls use the same override-and-refresh path. The Lab readout gets gameplay effects from that source. Static preview contexts without a source can still hold an explicit visual look.

## Controlled captures

`weather-fixture.mjs` prepares explicit surface history for the owned golden and road probes before capture. An isolated instance of the real Climate class, seeded with 1776, runs 84 calendar days of rain or 28 days of snow. Its computed wetness and snow are loaded into the Game climate before the captured state is measured. The city clock and canonical save file stay unchanged. The probe records the source type, history length and actual surface values.

The original renderer replay remains supported. When the renderer lacks a source binding, the helper uses the original force, settle and bare-ground setup. A direct wet-road probe on that renderer retains its original wetness assignment. The historical golden images and manifest remain unchanged.

The shared `scripts/refblock.mjs` hook still needs the matching explicit wet-weather setup. The request is recorded in `REQUESTS_ASTRA.md`. Older standalone captures in `carcam`, `communeQa`, `audit8` and `yellowflash` also use renderer surface assignments or force-and-settle alone. Their rainy capture setup needs the same explicit surface provenance before new wet-road baselines are accepted.

## Evidence

The zero-time contract passes 90 of 90 cases. Each case checks saved random state and wind angle, stable intensity and independently expected temperature, retained wetness and snow, and exact stability after an additional zero-time step.

The live check uses Chrome on NVIDIA RTX 5090 through ANGLE D3D11. Eight Game overrides each call the real source once and notify once. Their immediate fingerprint delta contains only weather. All paused frames preserve the full simulation fingerprint. Loading wetness 0.65 and snow cover 0.23 through the source remains exact across 300 paused frames. A normal day of fixed steps increases wetness during rain. Atmosphere Lab follows its own seeded source and keeps the complete climate save unchanged while paused.

The unchanged weather calendar regression passes. It observes 35 spells over two years at top speed, with the longest wet spell lasting 19 calendar days and the shortest visible spell lasting 12 seconds. It records no summer snow. At normal speed, the longest wet spell lasts six days across ten spells in 90 days.

The source snapshot is `work/water-weather-1794946012415`. Its paired predecessor differs only in Game weather binding, `world/weather.ts` and `dev/atmosphere.ts`. The focused reports are in `shots/weather-source` and the frozen runner logs in `shots/water/weather-*`.

The predecessor fails the same live check with zero page errors. Its weather presentation does not copy the saved source immediately or after paused frames, its forced source intensity remains stale, and its Lab has no Climate source. Only the three weather binding files differ between the paired sources.

The controlled road probes pass on Low, High and Ultra. The rain history yields measured wetness 0.996487. Repairing and drying restores the exact road pixels on Low and High. Ultra wet-road reflections use the full 1280×720 buffer. Both active and direct photo exports pass their current lens, native-state restoration, simulation fingerprint and frame-order checks.

Stepped, 30 fps and reload determinism agree on every system through day 10. Saves at days 3.03125 and 7.03125 reload exactly. Type checking and the registry lint pass.

The candidate source-list fingerprint is `4ce5ce9f87944a278686dcb876090c028a802661aefdabef38f0ae886d24f29b`. The paired predecessor is `39bf28328ef8c1e01e9e72c821b8b5f2227b7c774623a0c399c5179da6c196a7`. Each hashes the JSON-encoded ordered source file/hash list. Physical-phone measurements remain pending.
