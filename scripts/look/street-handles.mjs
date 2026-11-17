// BASE_URL serves the audio modules. Offline fixtures without a renderer
// handle remain compatible. A presentation observer overrides legacy allocation eligibility.
import { launch } from '../lib/browser.mjs';
const browser = await launch({ gl: false });
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/package.json');
  const rows = await page.evaluate(async () => {
    const { Synth } = await import('/src/audio/synth.ts');
    const { StreetAudio } = await import('/src/audio/streetAudio.ts');
    const rows = [];
    const cases = [
      { h: -1, expected: false }, { h: 4, expected: true }, { h: undefined, expected: true },
      { h: -1, selected: true, expected: true }, { h: 4, selected: false, expected: false },
      { h: undefined, selected: false, expected: true },
    ];
    for (const { h, selected, expected } of cases) {
      const context = new OfflineAudioContext(2, 22050, 22050);
      const synth = new Synth(context);
      const output = context.createGain(); output.connect(context.destination);
      const audio = new StreetAudio(synth, output, { rng: () => 0.5 });
      const cars = [{ id: 11, h, kind: 'semi', x: 4, y: 0, z: 4, yaw: 0, v: 10, crashed: 0 }];
      audio.update(0.3, cars, { x: 0, y: 2, z: 0, rx: 1, rz: 0, dist: 25 }, { speed: 1, rain: 0, wet: 0, hush: 0, drawn: selected === undefined ? undefined : id => id === 11 && selected });
      const sample = await context.startRendering();
      const signal = sample.getChannelData(0);
      const rms = Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);
      const voices = audio.debug().length;
      rows.push({ handle: h ?? null, selected, voices, rms, pass: expected ? voices > 0 && rms > 1e-5 : voices === 0 && rms === 0 });
    }
    return rows;
  });
  console.log(JSON.stringify(rows));
  if (rows.some(r => !r.pass)) process.exitCode = 1;
} finally { await browser.close(); }
