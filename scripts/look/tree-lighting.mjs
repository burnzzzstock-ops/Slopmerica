// BASE_URL selects the frozen renderer under test. Uses its real tree bake.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.OUT || 'shots/look/tree-lighting';
mkdirSync(out, { recursive: true });
const browser = await launch();

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(base + '/package.json');

  const result = await page.evaluate(async () => {
    const source = await (await fetch('/src/world/trees.ts')).text();
    const T = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { Trees } = await import('/src/world/trees.ts');
    const renderer = new T.WebGLRenderer();
    renderer.setPixelRatio(1);
    renderer.setSize(32, 32);
    const gl = renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const device = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);

    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 2;
    const material = new T.MeshBasicMaterial({ color: new T.Color(.25, .5, .75) });
    scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), material));
    renderer.toneMapping = T.NoToneMapping;

    // A framebuffer with an sRGB attachment encodes otherwise linear output.
    const transfer = [];
    for (const colorSpace of [T.LinearSRGBColorSpace, T.SRGBColorSpace]) {
      const target = new T.WebGLRenderTarget(1, 1);
      target.texture.colorSpace = colorSpace;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const data = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, data);
      transfer.push({ colorSpace, bytes: [...data] });
      target.dispose();
    }

    const atlas = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    atlas.colorSpace = T.LinearSRGBColorSpace;
    atlas.needsUpdate = true;
    const values = [
      [.16, .36, .64], [.2, .2, .2], [.4, .4, .4], [.6, .6, .6],
      [.16, .36, .64], [.2, .2, .2], [.4, .4, .4], [.6, .6, .6],
    ];
    const geometries = values.map((color, kind) => {
      const geometry = new T.PlaneGeometry(2, 2);
      const position = geometry.getAttribute('position');
      const colors = [];
      const canopy = [];
      for (let i = 0; i < position.count; i++) {
        geometry.getAttribute('normal').setXYZ(i, 0, 1, 0);
        colors.push(...color);
        canopy.push(1);
      }
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('canopy', new T.Float32BufferAttribute(canopy, 1));
      if (kind >= 4) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) {
          [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
        }
      }
      return geometry;
    });
    const geometryBytes = () => JSON.stringify(geometries.map(geometry => [
      ...geometry.getAttribute('position').array,
      ...geometry.getAttribute('normal').array,
      ...geometry.getAttribute('color').array,
      ...geometry.index.array,
    ]));
    const originalGeometry = geometryBytes();

    // A non-default caller state must survive both success and failure.
    const sentinel = new T.WebGLRenderTarget(13, 17);
    sentinel.viewport.set(1, 2, 10, 12);
    sentinel.scissor.set(2, 3, 8, 10);
    sentinel.scissorTest = true;
    renderer.setRenderTarget(sentinel);
    renderer.setClearColor(0x253647, .37);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    const state = () => JSON.stringify({
      target: renderer.getRenderTarget()?.uuid,
      clear: renderer.getClearColor(new T.Color()).toArray(),
      alpha: renderer.getClearAlpha(),
      tone: renderer.toneMapping,
      viewport: renderer.getViewport(new T.Vector4()).toArray(),
      scissor: renderer.getScissor(new T.Vector4()).toArray(),
      scissorTest: renderer.getScissorTest(),
    });
    const initial = state();
    const random = Math.random;
    const render = renderer.render;
    let draws = 0;
    let passes = 0;
    let texture;
    Math.random = () => {
      draws++;
      return random();
    };
    renderer.render = function(...args) {
      passes++;
      return render.apply(this, args);
    };
    try {
      texture = Trees.prototype.bakeSprites.call({ spriteSize: [] }, renderer, geometries, atlas);
      renderer.initTexture(texture);
    } finally {
      Math.random = random;
      renderer.render = render;
    }
    const restored = state() === initial;

    const width = texture.image.width;
    const height = texture.image.height;
    const data = texture.image.data;
    const samples = [];
    for (let row = 0; row < 2; row++) {
      for (let kind = 0; kind < 8; kind++) {
        const rgb = [0, 0, 0];
        let count = 0;
        for (let y = row * 512; y < (row + 1) * 512; y++) {
          for (let x = kind * 256; x < (kind + 1) * 256; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] !== 255) continue;
            count++;
            for (let channel = 0; channel < 3; channel++) rgb[channel] += data[i + channel];
          }
        }
        const actual = rgb.map(value => value / Math.max(1, count));
        const expected = values[kind].map(value => value * 255);
        samples.push({
          row, kind, count, actual, expected,
          error: Math.max(...actual.map((value, i) => Math.abs(value - expected[i]))),
        });
      }
    }

    let failure = false;
    let throwDraws = 0;
    renderer.render = () => { throw Error('injected bake failure'); };
    Math.random = () => {
      throwDraws++;
      return random();
    };
    const wrapper = Math.random;
    try {
      Trees.prototype.bakeSprites.call({ spriteSize: [] }, renderer, geometries, atlas);
    } catch (error) {
      failure = error.message === 'injected bake failure';
    }
    const restoredAfterThrow = state() === initial;
    const restoredRandom = Math.random === wrapper;
    Math.random = random;
    renderer.render = render;

    const textureBytes = texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
    const output = {
      device, transfer, samples, draws, throwDraws, passes,
      restored, restoredAfterThrow, restoredRandom, failure,
      geometryUnchanged: geometryBytes() === originalGeometry,
      texture: [width, height],
      textureBytes,
      colorSpace: texture.colorSpace,
      glError: gl.getError(),
    };
    texture.dispose();
    atlas.dispose();
    sentinel.dispose();
    geometries.forEach(geometry => geometry.dispose());
    renderer.dispose();
    return output;
  });

  writeFileSync(out + '/result.json', JSON.stringify({ base, ...result, errors }, null, 2) + '\n');
  assert.deepEqual(errors, []);
  assert.equal(result.glError, 0);
  assert.ok(result.transfer[0].bytes.slice(0, 3).every((value, i) =>
    Math.abs(value - [64, 128, 191][i]) <= 1
  ));
  assert.ok(result.transfer[1].bytes[0] > result.transfer[0].bytes[0] + 50);
  assert.ok(
    result.samples.every(sample => sample.count > 1000 && sample.error <= 2),
    'Linear albedo round-trip and identical bent backface normals'
  );
  assert.equal(result.draws, 0);
  assert.equal(result.throwDraws, 0);
  assert.equal(result.passes, 16, 'One photograph per species/view');
  for (const key of ['restored', 'restoredAfterThrow', 'restoredRandom', 'failure', 'geometryUnchanged']) {
    assert.equal(result[key], true, key);
  }
  assert.deepEqual(result.texture, [2048, 1024]);
  assert.equal(result.colorSpace, 'srgb-linear');
  console.log('PASS linear albedo round-trip, bent backfaces,16 bake draws, fixed atlas, unchanged geometry, renderer restoration and zero global RNG');
} finally {
  await browser.close();
}
