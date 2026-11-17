# Audio evidence

## A1 camera-local soundscape

Measured on 2026-11-17 with Chrome 157 on Windows. The source checks, seeded offline renders, TypeScript check, `audiotest` and all 17 `soundtest` assertions pass. I cannot audition audio in this environment. Perceptual balance and recognition await the owner's listening review.

### Runtime changes

- `Game.frame` samples the existing `fields.naturePct()` and `fields.pollutionAt()` every 0.5 seconds. Cars, people and active construction are distance-weighted within 200 m of the camera target. Sound inputs and actor records reuse fixed storage.
- Habitat uses the simulation reference trees, independent of graphics density. Full local habitat is 160 trees within 200 m. This tuning choice lets a clearcut camera neighborhood become quiet while most of the county remains forested. The tree sample is anchored to 32 m cells. A decrease in the same cell produces a six-second clearing envelope.
- The effective nature level is county nature × local habitat × `exp(-2 × pollution)`. Existing seasonal birds, frogs, insects and water beds use that level. Surf uses the existing water samples and coastal sand coverage.
- The nearest eight eligible, drawn, camera-visible actors can contribute calls. Gulls, pelicans, crows, small birds, sea lions and alligators use procedural voices. Three persistent engine slots follow visible moving fishing boats, bass boats and jet skis. Panning follows camera space. Boat motors and new actor calls stop on pause, with existing gain smoothing.
- Ambient phrases have an eight-phrase concurrency cap. The new chainsaw and leaf-blower phrases share it. Sound, reverb and Music retain their existing Settings controls. Existing camera-local street engines continue through `StreetAudio`.
- `Synth` accepts an injected random source. The game passes a local seeded generator, and the measured ambience path consumes zero global random draws.

### Real valley pair

`audio-valley` creates Holler County with world seed 271828 and pins one camera for both captures. It builds roads, zones and eight services through existing game entry points, clears reference trees and advances the actual simulation for 240 days. The two audio snapshots use summer, noon and clear weather. No field values are replaced in this scenario.

| Captured input | Pristine | Developed |
| --- | ---: | ---: |
| Population | 0 | 213 |
| Buildings | 0 | 67 |
| Road segments | 26 | 99 |
| Cars at capture | 0 | 28 |
| County reference trees | 232,331 | 214,698 |
| Trees within 200 m of target | 601 | 0 |
| Field nature | 1.0000 | 0.9223 |
| Field pollution | 0 | 0.08566 |
| Local traffic mix | 0 | 0.13237 |
| Local people mix | 0 | 0.11158 |
| Local habitat mix | 1 | 0 |

Camera position is `[-521.4838815211866, 106.91605555340934, 192.77608373625478]`, target `[-635, 10.086230635643005, 135]`, distance 160 m. Position, quaternion, target and distance match exactly between captures. The developed case is a small town with a cleared neighborhood and 7.8% county tree loss. No coastal actors are audible at this camera.

The captured mixes feed the actual `Ambience` class for 30 seconds each with audio seed 1776. The WAVs are stereo 24 kHz, 16-bit PCM. They hold each captured mix constant through an `OfflineAudioContext` render. These are steady-state snapshot comparisons. They exclude music, individual street-engine voices and the final master compressor. The ambience and reverb gains match the game's default master scaling.

| Measured output | Pristine | Developed |
| --- | ---: | ---: |
| Bird phrases / 30 s | 30 | 0 |
| All phrases / minute | 60 | 2 |
| Spectral centroid, 40 Hz–10 kHz | 1,954 Hz | 347 Hz |
| Energy below 250 Hz | 13.69% | 55.59% |
| Energy above 2 kHz | 41.88% | 0.096% |
| Integrated loudness | −46.4 LUFS | −49.9 LUFS |
| True peak | −31.1 dBFS | −38.9 dBFS |
| Peak linear amplitude | 0.02767 | 0.01125 |
| Global random draws | 0 | 0 |

The developed snapshot has one leaf-blower phrase. Its traffic contribution is a continuous bed, so phrase count measures discrete events separately from sustained energy. Loudness comes from the installed FFmpeg EBU R128 filter. The frequency-energy shift and lower bird density pass the scripted acceptance bounds. Human listening remains open.

![Same-camera soundscape spectrum](figures/soundscape-spectrum.png)

### Focused regressions

| Check | Measured result |
| --- | --- |
| Pollution-only controlled pair | 30 → 6 bird phrases with unchanged nature |
| Frozen original pollution pair | 29 → 29 bird phrases, expected acceptance failure |
| Boat pan | 94.41% right-channel energy for pan 0.7 |
| Boat runtime nodes | 67 built, 67 after five seconds |
| Paused isolated boat | Peak and RMS both 0 |
| Source eligibility | Four visible species included, behind-camera, distant and night-hidden actors excluded |
| Hidden actor group | Zero eligible sources |
| Source storage | Same array and same eight records reused |
| Actor phrase stress | Maximum eight simultaneous phrases, peak 0.10877 |
| Local car moved 20 km away | Traffic mix 0.04161 → 0 |
| Local tree decrease 10 → 4 | Clearing envelope 0.5 |
| Controlled coast | Two sea-lion calls and seven gull calls / 30 s, −31.7 LUFS, −19.3 dBFS true peak |
| Clearing fixture | Four chainsaw phrases / 8 s |
| Noise continuity | All three 9.3-second loops pass seam checks, strongest rhythmic repeat 0.122 |
| Settings | All 17 assertions pass, including sound/reverb mute, separate Music, persistence and 44 px phone targets |

The original source already separated explicit synthetic nature and traffic inputs spectrally. The new regressions target pollution response, real camera-local inputs, source eligibility, boat motors and clearing voices. Controlled fixtures complement the game-derived valley pair.

### Reproduction and artifacts

Serve the current checkout on a free local port and set `BASE_URL` to that origin. `CHROME` can select the installed browser through the shared launcher.

```powershell
node scripts/look/audio-sources.mjs
node scripts/look/audio-valley.mjs
$env:MIX_FILE = 'shots/audio/game/mixes.json'
$env:TAG = 'game'
node scripts/look/soundscape.mjs
Remove-Item Env:MIX_FILE
$env:TAG = 'after'
node scripts/look/soundscape.mjs
node scripts/audiotest.mjs
node scripts/soundtest.mjs
```

`shots/audio/game/` contains the real mixes, WAV pair, spectrum and loudness reports. `shots/audio/after/` contains the controlled coastal, source, clearing and pause fixtures. `audio-sources` and `soundscape` are registered in the full tier. Town construction is registered as the measure-tier `audio-valley` scenario. The owner-facing listening pack is copied to `outputs/Audio/` in this task's workspace.

### Owner listening checklist

- Compare `valley-pristine.wav` and `valley-developed.wav` at the same playback volume. Check that the forest reads as living habitat and the developed view as a low traffic bed.
- Check bird phrases for repetition, sharpness and excessive cicada hiss over the full 30 seconds.
- In `coast.wav`, assess surf texture, gulls, sea-lion calls and engine balance. Check stereo placement on headphones.
- In `clearing.wav`, assess whether the procedural chainsaw is recognizable and its onset is comfortable.
- In `boat.wav`, check the motor's timbre and right-side placement. `boat-paused.wav` is an exact-silence control.
- In the game, change Sound and Music independently, pan between forest and roads, pause near a moving boat, and verify the transition by ear.

Further authored car-alarm and fireworks/gunshot events remain part of the event-driven sound work. This A1 evidence covers the field-driven health-bar transition, local traffic bed, clearing and visible coastal life.

## A2 adaptive procedural score

The existing felt piano supplies the common harmony and bar clock. Its standalone defaults remain 62 bpm by day and 56 bpm at night. `musictest` passes with 57 day notes and 31 night notes, every note in key, lowest MIDI 38, peaks 0.066 and 0.043. Composition randomness and timbre randomness use separate seeded sources in the game.

### Arc and controls

`AdaptiveScore` uses the existing `tierAt(population)` function. At 0 people the felt piano carries the score. Porch banjo and fiddle reach full gain at 150 people. Muzak blends in across the 350–1,100 population tiers. Country guitar, bass and percussion replace it across 1,800–4,200 people. A quiet piano layer persists. These are tuning choices for the original requested arc.

Banjo and guitar use short decaying string partials. Fiddle uses a bowed sawtooth voice with vibrato and a slower attack. Muzak combines triangle notes and held harmony. Country uses strummed chords, a bass line, melodic fills, kick, snare and hi-hat. The tension layer stays diatonic. Every pitched stem shares the piano's current major key.

Layer gain transitions use 1.5-second time constants. Tempo moves toward 62, 72 or 96 bpm across the arc, eased over four seconds. Cash below $5,000 adds tension, reaching full financial pressure at −$10,000. Jam pressure uses `1 - flowEma`. Disasters lower the accompaniment, add tension and slow tempo. Night reduces level and tempo. Winter and night halve the porch picking density and soften percussion.

The game passes population, cash pressure and `flowEma` through the reused sound mix. Hurricane intensity is available from live weather. The `disaster` event subscriber tracks concurrent kinds independently, preserving the remaining event when another ends. The current simulation source has no `disaster` emitter. FABLE's producer wiring remains necessary for the other disaster kinds.

Music keeps its existing on/off and volume controls, including independent operation while Sound is off. Paused simulation retains the existing continuing-music behavior. New voices are scheduled at bar boundaries. The ten offline cases allocate zero audio nodes on updates that schedule no bar.

### Measured stems and sweep

Chrome `OfflineAudioContext` renders stereo 24 kHz PCM with the default 0.8 master scaling and reverb. Measurements precede the master compressor. Isolated stem files retain their live score gains. LUFS comes from the installed FFmpeg EBU R128 filter.

| Render | Duration | Peak | True peak | LUFS |
| --- | ---: | ---: | ---: | ---: |
| Felt piano | 50 s | 0.04771 | −26.4 dBFS | −42.8 |
| Porch banjo and fiddle | 50 s | 0.01848 | −34.6 dBFS | −49.1 |
| Muzak | 50 s | 0.01533 | −36.3 dBFS | −53.3 |
| Country band | 50 s | 0.03731 | −28.6 dBFS | −44.8 |
| Tension | 50 s | 0.01044 | −39.6 dBFS | −52.2 |
| Radio jingle | 50 s | 0.01097 | −39.2 dBFS | −53.2 |
| Winter-night porch | 50 s | 0.01296 | −37.7 dBFS | −53.1 |
| Population and stress sweep | 120 s | 0.04565 | −26.8 dBFS | −46.0 |

The sweep moves through six 20-second states. They are empty valley, 350 people, 1,800 people, 6,500 people, financial/jam/disaster pressure, and winter night. It schedules 177 piano, 56 banjo, 14 fiddle, 63 muzak, 273 guitar, 42 bass, 30 tension and 8 jingle notes. All pitches pass the major-scale check. Measured bar tempos span 62–95.73 bpm. Maximum adjacent-sample change is 0.006741, below the 0.04 waveform gate. Listening remains necessary to assess perceived clicks and musical transitions.

![Adaptive score sweep](figures/score-sweep.png)

The controlled winter-night porch schedules 48 banjo and 12 fiddle notes, compared with 112 and 28 by day. The mute fixture is exactly silent in seconds 25–30. Every offline case consumes zero global random draws. Timbre seed 1776 and composition seed `0x5c0a3` are independent. A repeated country render has an identical note/timing sequence. Fourteen of 2,400,000 PCM samples differ by one 16-bit least-significant unit due to browser DSP rounding. The repeat gate requires identical note sequences and a maximum one-unit PCM difference.

`score-state` exercises the actual reference-town `Game.frame` path at 781 people. It observes financial pressure 1, flow 0.1 and tension 0.6, with the simulation day held fixed. Concurrent disaster levels progress 0.8 → 0.4 → 0. Music remains active with Sound off and fades below 0.001 when Music is disabled. All 17 existing phone Settings checks pass with the adaptive score attached.

### Radio text handoff

Every sixteenth country bar becomes an original eight-note jingle. `AudioEngine.onRadioAd` supplies the matching text at playback time. The callback drops stale announcements after a long frame pause. FABLE owns displaying the text through the feed or an on-screen radio caption. The three authored lines are exported as `RADIO_ADS` in `src/audio/score.ts`.

- Dillo’s Mega Stop. One hundred pumps. One destination. Every exit.
- SLOP Home Loans. Build your future on the equity of your future.
- Freedom Motors. More truck for every square foot of driveway.

The score uses original synthesis throughout. No samples, speech service or dependency were added. Automatic feed display is pending the UI handoff.

### Reproduction and listening

```powershell
node scripts/look/score.mjs
node scripts/look/score-state.mjs
node scripts/musictest.mjs
node scripts/soundtest.mjs
```

`adaptive-score` and `score-state` are registered in the full tier. `shots/audio/score/` contains the WAVs, measured JSON and sweep figure. The owner pack includes the 120-second sweep, isolated stems and a five-second jingle excerpt beginning 39.4 seconds into the full jingle render.

- Listen to `score-sweep.wav` with the pictured 20-second boundaries. Assess whether the porch, commercial and radio stages are distinct and the transitions comfortable.
- Compare `score-porch.wav` and `score-winter-night.wav`. Assess picking density and bowed-string recognition.
- Check `score-muzak.wav` and `score-country.wav` for repetition, harshness and balance against city sounds.
- Check `score-tension.wav` for financial/disaster mood and `score-jingle.wav` for the station-break character.
- In the game, test Music off/on, Music volume and Sound off while music continues. Owner listening is still pending.
