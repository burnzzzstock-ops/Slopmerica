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
