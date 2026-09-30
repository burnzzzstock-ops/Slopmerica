# Street sound follows the real cars (audit #10, handoff item 7)

Branch `wt/audio`. Owner of the change: helper `audio`. Everything is procedural WebAudio; nothing is downloaded and there
are no new dependencies. The simulation is untouched: the street audio only reads `traffic.cars`.

## What the audit found, and what the code did

`src/audio/ambience.ts` (old lines ~230 and ~268) made the street from three things, none of which knew a car existed:

- one brown-noise bed scaled by `min(1, cars / 400)` (kept: it is the distant city hum);
- `honkVoice` fired at random, `traffic * 0.12 * (0.4 + 0.6 * near)` times a second, whatever the traffic was doing;
- `passby`, a band-passed noise sweep fired at random, `traffic * near * 0.7` times a second.

The only siren was the one-shot SFX `siren` (city-alert banner in `hud.ts`), attached to nothing. `Ambience.update(dt, mix)`
takes an aggregate `SoundMix`, so a jam and free flow, a semi and a motorcycle, dry and wet roads all reach it as the same
number. Measured on the old code (60 s of `traffic = 0.6`, the same input either way): **6 random honks in a free-flowing
scene, 4 in a "jam"**; no other property of the street could be measured because none existed.

## What changed

New files (all in `src/audio/`, environment-free: they need only a `Synth`, so they render offline):

| file | what |
| --- | --- |
| `streetProfiles.ts` | the data: per-kind engine, horn and siren recipes (`ENGINES`, `HORNS`, `SIRENS`), and the pure functions Doppler, distance, jam rate |
| `streetAudio.ts` | `StreetAudio`: the voice pool, the 4 Hz scan, the 16 Hz parameter glide, the jam clustering, the limiter |

Wiring (small, all commented):

- `audio.ts`: `AudioEngine.street(dt, cars, cam, wet, speed)` and a `quality` field. The pool is built in `unlock()` (so the
  browser's user-gesture rule is respected, exactly like the other beds), goes to the same bus as the ambience (mute and
  volume settings apply), sleeps while muted, paused, suspended or zoomed out to the map (muted and suspended are fed to it as "paused").
- `ambience.ts`: `randomTraffic` flag. The first time cars are fed, the random honks and pass-bys are switched off. The bed stays.
  `RAIN` is exported.
- `game.ts`: two lines, next to `this.audio.update(...)`: `this.audio.street(dt, this.traffic.cars, this.rts, this.weather.wet, spd)`
  and `this.audio.quality = this.q.name` after `audio.mapId`.
- `dev/streetaudio.html`: an audition page (no game): scripted cars drive past the listener; buttons for each vehicle,
  sirens, a jam, free flow; rain and wet-road sliders; a live readout of the voices. Open it from the dev server.

### How it behaves

1. **Pass-bys from real cars, with Doppler.** A fixed pool (8 car voices; 6 on Medium; 4 on Low) is handed to the loudest
   cars near the listener. "Loudest" is the kind's source level times the distance gain, so a semi at 60 m outranks a golf
   cart at 40 m; a car that already has a voice gets a 35% bonus so voices do not flicker; cars under a floor get none.
   Doppler is `c / (c + v_radial)` with the car's speed along its heading, applied to every pitched component (engine,
   whine, tyre band); pan follows the bearing against the camera's right vector; a low-pass closes with distance.
2. **Engines by kind** (`ENGINES`). One recipe, tuned per kind: a `PeriodicWave` (four, six, V8, diesel, bike, EV, cart), a
   gear model (each gear runs from a low to a high rev, so pitch climbs and drops with speed), throttle from `car.acc`
   (louder and brighter under power, duller when braking), exhaust noise, a lope for V8s and diesels that fades as they speed
   up. Idle is quiet (`idleLevel`: a queue of idling cars is a murmur). Specials:
   - **semi:** low diesel with a turbo whistle under load; **jake brake**: when it lifts off hard (`acc < -1.4` above 5 m/s)
     the engine chops at 21 Hz and gets louder; air-brake hiss when it stops. Buses, fire truck, garbage truck, box truck and tow truck get the hiss too;
   - **motorcycle:** high and buzzy (a 48-harmonic wave, opened to 4.8 kHz);
   - **lifted truck:** the loudest non-diesel: deep V8 with a heavy lope, open exhaust, mud tyres;
   - **Cyberslop:** near silence plus a motor whine that rises with speed (0.7 to 3.6 kHz);
   - **garbage truck:** a hydraulic whine (620 Hz, warbling) that runs while it stands still;
   - **golf cart:** a light whir (0.5 to 1.25 kHz).
3. **Honks from jams.** Each 4 Hz scan collects the cars waiting on the road (`v < 0.8`, not pulling in or out of a lot, not
   `parked`), links the ones whose gaps are queue-sized (`0.5 * (len_a + len_b) + 5.5 m`; union-find over at most 160 cars),
   and gives every car in a queue of 3 or more a chance to honk: `0.035 * impatience * min(3, (size - 2)^0.55) * dwell`,
   where `dwell` ramps from 0 at 6 s stopped to 1 at 30 s, and `impatience` is a stable per-car number (35% of drivers never
   honk). So: lone cars and pairs never honk, nobody honks in the first 6 s, the rate climbs with the queue and with how long
   it has sat. Tones differ by kind (sedan 415+523 Hz, semi air horn 175+220+262, motorcycle a beep, lifted truck a three-note
   chord, golf cart a meep, ...), each driver's horn is tuned +/- 5% by id, and a honk is a single, a double-tap, or (in big
   jams) a long lean. Up to 4 horns at once (2 on Low), each placed at the honking car.
4. **Sirens.** Police, ambulance and fire truck only (`hasSiren`; the tow truck is a beacon and stays silent). A siren voice
   rides the vehicle while it is moving (starts above 1.5 m/s, stays above 0.6 m/s), audible to 480 m, with Doppler on the
   carriers' detune so the pattern and the shift do not fight. Patterns (`sirenAt`): police wail, then a burst of yelp;
   ambulance hi-lo, then a fast wail; fire truck a slow dark mechanical wail with the air horn leaning in every 9 s. A wrecked
   vehicle (`crashed != 0`) is silent. At most 3 (2 on Low).
5. **Tyres and rain.** Every car voice has a road-roar band (speed^1.7, pitch rises with speed) and a wet-road hiss (3 kHz and
   up) that scales with road wetness (`weather.wet`), rain intensity and speed. A parked car in the rain is silent; a car
   beyond the pool's reach has no voice, so only near cars hiss.

### Cost

- The pool is built once (High: 15 voices, 265 audio nodes; ~20 nodes per car or siren voice, ~10 per horn). Idle voices are
  disconnected from the graph, so the browser does not render them. No node is created while playing (test below).
- `update()` runs every frame but only re-picks voices 4 times a second (median 0.2 ms with 1,900 cars, p90 0.3 ms on this box)
  and moves AudioParams 16 times a second; the rest of the frames cost about 0.01-0.03 ms. Parameter writes are skipped when the
  change is under a small epsilon.
- Low preset (phones): 4 car voices, 2 sirens, 2 horns (146 audio nodes for the whole pool, against 215 on Medium and 265 on High). A
  live preset switch caps the pool (`limit()`); the game reloads to change preset anyway.
- Zoomed out (camera distance 200 m and up the cars fade; past 900 m they are gone, sirens carry to 1,600 m), paused, muted or
  suspended: every voice is released and disconnected (`sleep()`), zero cost.

## Measurements (`scripts/streetaudio.mjs`)

The test renders `StreetAudio` offline (`OfflineAudioContext`, 22.05 or 44.1 kHz stereo) with scripted cars and measures with an
FFT. It needs no game page (any file of the dev server gives it an origin), so it runs in about 40 seconds. Run against the
frozen old code (`BASE_URL=http://127.0.0.1:5175`) there is no street to test, so the checks fail with the reason; against the
new code every check passes.

| what | old code | new code |
| --- | --- | --- |
| Doppler, Cyberslop whine at 30 m/s, 10 m off the ears (physical: 2,930 Hz approaching, 2,464 Hz receding) | no per-car pitch | **2,931 Hz -> 2,465 Hz**, ratio 1.189 (physical 1.189) |
| Doppler, ambulance hi-lo low tone, 30 m/s (physical 744.4 -> 625.9 Hz) | none | **744.7 -> 626.2 Hz** |
| semi vs motorcycle, spectral centroid at 15 m, 13 m/s | same noise bed either way | **460 Hz vs 1,152 Hz** (65% of the semi's power under 250 Hz, 25% of the motorcycle's) |
| Cyberslop: share of 0.6-5 kHz power in one 60 Hz line | n/a | **47%** (1,591 Hz whine) vs 10% semi, 21% sedan |
| loudness at 15 m vs a sedan (0.0153 rms) | n/a | semi 2.4x, lifted truck 2.4x, city bus 1.8x, motorcycle 1.0x, Cyberslop 0.9x, golf cart 0.6x |
| a car idling in a queue vs cruising | n/a | **4.9x quieter** (0.0031 vs 0.0153 rms) |
| semi engine brake: modulation depth at 18-25 Hz | n/a | **0.47** vs 0.014 cruising |
| garbage truck hydraulic whine (586 Hz line, share of 450-900 Hz) | n/a | **62%** stopped vs 29% moving |
| free-flowing traffic, 14 cars, 60 s | **6 random honks** | **0 honks**, horn bus silent (0.0 rms) |
| 10-car queue, 60 s | **4 random honks** (no relation to the queue) | **12 honks**, first at 18 s, all from queued cars |
| honks per minute by queue size (3 seeds) | ~5 whatever | 2 cars: **0**; 4 cars: 7; 8 cars: 13.7; 14 cars: 28.7 |
| siren, ambulance passing left to right | one-shot, attached to nothing | pan **-1.00 -> -0.03 -> +1.00**; level 6.6x louder at the closest point than 100 m out |
| siren once the fire truck has stopped | n/a | silent (-240 dB, voice released); tow truck, sedan and wrecked police car: 0.0 rms |
| rain: 3.5-9 kHz band, sedan 13 m/s at 12 m | n/a | dry 14 dB, wet road no rain 26.4 dB (+12.4), rain 31.1 dB (**+17.1**); parked in rain 0 dB change; 25 m/s is +9.3 dB over 5 m/s |
| worst-case mix (40 cars of all 19 kinds, 12 in a queue, 3 sirens, rain, everything within 30 m) | n/a | peak **0.90-1.08 before** the limiter, **0.74 after**; a busy street peaks at 0.43-0.50 (limiter idle) |
| paused game, then unpaused | n/a | street **-240 dB** and 0 voices while paused (asleep); 6 voices back after, -0.4 dB vs before; camera at 1,800 m: 0 voices |
| voice pool | none | 8 car voices / 3 sirens / 4 horns (crowd hits 8/3/2); Low 4/2/2; **0 nodes created while running** (270 built up front) |
| `update()` with 1,900 cars, all within 300 m, 40% stopped | n/a | scan frame (4 Hz) median 0.2 ms, p90 0.3 ms; other frames ~0.03 ms |

Spectrograms (`scripts/streetaudio-figure.mjs`, same colour scale in every panel):
`docs/screenshots/cars-look/audio-spectrograms-before.jpg` (the old ambience: one bed, random honks, the same "semi" and
"motorcycle") and `audio-spectrograms-after.jpg` (Doppler pass, four engines, ambulance pass with pan trace, dry vs rain,
a queue's honks vs free flow).

## Tests run

- `scripts/streetaudio.mjs` (new): 45 checks, all pass on the new code; on the old code 6 fail by construction (no street to test).
- `scripts/streetaudio-game.mjs` (new): the wiring in the real game, on the reference block at Low: 13 checks, all pass. The frame
  loop feeds `traffic.cars` (102 cars); the pool builds after the unlock; 2 voices go to the real cars near the camera (cap 4 on
  Low; e.g. a sedan at 31 m, gain 0.031, pan -0.71, pitch x0.962); the old random honks are off; camera at 1,800 m: 0 voices,
  asleep; back at 60 m: voices return; paused, muted: asleep; resumed, unmuted: voices return; a 10-car queue honks (2 honks in
  60 s of street time), 12 free-flowing cars do not.
- `scripts/audiotest.mjs` (must keep passing): 9 of 9 OK on the snapshot of the final code (noise loops 9.3 s, seams 0.35x / 0.02x / 0.56x a
  typical step, no offset, strongest repeat in a busy town's beds 0.122 at 0.9 s against the 0.35 limit, no page errors).
- Not run (nothing they cover was touched: the change is audio-only plus two lines in the frame loop): `nighttest`, `nightglow`,
  `qualitytest`, `glcheck`, `shadercheck`, `treelod`, `impostortest`, `reflecttest`, `motiontest`, `scaletest`, `junctiontest`, the UI set. No
  drawing or simulation code changed, so `drawcalls`/`perfTown` have nothing to compare; the audio cost is in the table above.

## Notes for the lead and the traffic session

- The street audio reads only `kind, id, x, y, z, v, yaw, crashed` and optionally `acc, len, dep, arr, parked` from `traffic.cars`. If the
  traffic pass keeps parked cars in `traffic.cars` with `v = 0`, it must set `parked: true` on them (or keep them out of the array),
  or a full car park would read as a jam and honk.
- Emergency lights are always on in the vehicle model today, so "siren when moving" is the rule. If `setParked`/lights per vehicle
  arrive, gate `hasSiren` on them in `StreetAudio.scan`. Returning trips (`purpose === 'heading back to base'`) could be silent
  (lights only); left loud on purpose, since the lights are on.
- Game speed: at 2x the Doppler uses the doubled speed (capped at 2x); paused silences the street after 1.5 s.
- Constants worth an owner listen (all in `streetProfiles.ts` / the top of `streetAudio.ts`): `ENGINES[kind].level`, `honkRate`
  (`0.035`), `TRIM_ENGINE`, `TRIM_SIREN`, the 200 to 900 m zoom fade in `update()`.

## Not done

- Nobody has listened to it. The numbers above are measurements of levels, pitch and timing; how it sounds (the balance between
  engines and the ambience bed, whether the honk rate feels right) needs an ear. `dev/streetaudio.html` is there for that.
- Crash sound for wrecked cars in a pile-up, tyre squeal, gravel/dust, reversing beeper, ice-cream-truck jingle.
- Tail of the old brown-noise traffic bed is unchanged (it is the far-city hum); it could be thinned near the camera now that near cars have voices.
