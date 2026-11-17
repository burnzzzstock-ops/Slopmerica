// BASE_URL is unused: this read-only water and render-state contract runs in Node.
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
const server = await createServer({
  cacheDir: "shots/tmp/vite/waterunit-" + process.pid,
  root: process.cwd(),
  server: {
    middlewareMode: true,
    watch: null,
    hmr: false,
    ws: false
  },
  appType: "custom",
  logLevel: "error"
});
const rows = [], check = (name, pass, detail) => {
  rows.push({
    name,
    pass,
    detail
  });
  console.log(pass ? "OK" : "FAIL", name, detail ?? "");
};
try {
  const T = await server.ssrLoadModule("three");
  const { createWater, WaterReflection } = await server.ssrLoadModule("/src/world/water.ts");
  const { WaterRefraction } = await server.ssrLoadModule("/src/render/refraction.ts");
  const { GodRays } = await server.ssrLoadModule("/src/render/godRays.ts");
  const { installAerialPerspective } = await server.ssrLoadModule("/src/render/aerialPerspective.ts");
  const heights = new Float32Array(1537 ** 2).fill(-2.6);
  const terrain = {
    map: { rivers: [[{
      x: -3100,
      z: 0
    }, {
      x: 3100,
      z: 0
    }]] },
    heights,
    h: () => -2.6,
    heightTex: new T.DataTexture(new Float32Array([-2.6]), 1, 1, T.RedFormat, T.FloatType)
  };
  const w = createWater(terrain, {
    shallow: 3844792,
    deep: 801378,
    murk: 5930346
  }, false);
  const field = {
    w: 4,
    h: 4,
    max: 2,
    version: 1,
    data: new Float32Array(16)
  };
  const fields = {
    fieldFor: () => field,
    pollutionAt: () => field.data[0] / field.max
  };
  w.updateFields(fields);
  check("clean field has no river fire", w.fire.count === 0 && !w.fire.mesh.visible);
  field.data.fill(8);
  field.data[1] = NaN;
  field.version++;
  w.updateFields(fields);
  check("actual high pollution creates bounded river fire", w.fire.count > 0 && w.fire.count <= 64 && w.fire.mesh.visible, w.fire.count);
  check("pollution uses normalized field and clean NaN", w.pollution.texture.image.data[0] === 255 && w.pollution.texture.image.data[1] === 0);
  const uploads = w.pollution.uploads, texture = w.pollution.texture.image.data;
  let random = 0;
  const rnd = Math.random;
  Math.random = () => {
    random++;
    return rnd();
  };
  for (let i = 0; i < 300; i++) w.updateFields(fields);
  Math.random = rnd;
  check("unchanged versions neither allocate/upload nor consume RNG", w.pollution.uploads === uploads && w.pollution.texture.image.data === texture && random === 0);
  field.data.fill(0);
  field.version++;
  w.updateFields(fields);
  check("clearing actual pollution removes every flame", w.fire.count === 0 && !w.fire.mesh.visible);
  const flow = w.mat.uniforms.uFlow.value.image.data, row = 128 * 256;
  const direction = T.DataUtils.fromHalfFloat(flow[(row + 128) * 4]);
  const relief = [...flow].filter((_, i) => i % 4 === 2).map(T.DataUtils.fromHalfFloat);
  check("flow follows source to outlet with bounded relief", direction > .99 && Math.max(...relief) <= .281 && Math.min(...relief) >= 0, {
    direction,
    maxRelief: Math.max(...relief)
  });
  check("surface geometry is finite and terrain unchanged", [...w.mesh.geometry.attributes.position.array].every(Number.isFinite) && heights.every((h) => h === -2.6 || Math.abs(h + 2.6) < 1e-6));
  w.setQuality("ultra");
  check("live Ultra creates mirror", !!w.reflection);
  w.setQuality("low");
  check("live Low releases mirror", !w.reflection);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(50, 2, .2, 1e4);
  camera.position.set(0, 30, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  let target = null;
  const fake = {
    capabilities: { maxTextureSize: 8192 },
    shadowMap: {
      autoUpdate: true,
      needsUpdate: true
    },
    autoClear: true,
    getDrawingBufferSize: (out) => out.set(2400, 1200),
    getRenderTarget: () => target,
    setRenderTarget: (t) => {
      target = t;
    },
    clear() {},
    render() {},
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getScissorTest: () => true,
    getViewport: (out) => out.set(0, 0, 2400, 1200),
    getCurrentViewport: (out) => out.set(0, 0, 2400, 1200),
    getPixelRatio: () => 1,
    getScissor: (out) => out.set(1, 2, 100, 200),
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    initRenderTarget() {},
    copyTextureToTexture() {}
  };
  for (const [scale, width] of [
    [.25, 600],
    [.5, 1200],
    [1, 2400]
  ]) {
    const mirror = new WaterReflection(scale);
    mirror.render(fake, scene, camera, [w.mesh], 0);
    check(`mirror scale ${scale} uses exact buffer ratio`, mirror.rt.width === width && mirror.rt.height === width / 2, {
      width: mirror.rt.width,
      height: mirror.rt.height
    });
    check("stationary mirror cadence remains 30 Hz", !mirror.render(fake, scene, camera, [w.mesh], 1 / 60));
    mirror.rt.dispose();
  }
  const refraction = new WaterRefraction(fake, scene, w.mesh, "high");
  const rt = new T.WebGLRenderTarget(2400, 1200);
  rt.depthTexture = new T.DepthTexture(2400, 1200);
  target = rt;
  scene.add(w.mesh);
  camera.layers.mask = 5;
  w.mesh.layers.mask = 9;
  w.fire.mesh.layers.mask = 7;
  const background = new T.Color("red");
  scene.background = background;
  for (const fail of [
    "opaque",
    "copy",
    "water",
    "none"
  ]) {
    fake.render = () => {
      if (fail === "water") throw new Error("water");
    };
    fake.copyTextureToTexture = () => {
      if (fail === "copy") throw new Error("copy");
    };
    let threw = false;
    let errorMessage;
    try {
      refraction.render(rt, camera, () => {
        if (fail === "opaque") throw new Error("opaque");
      });
    } catch (error) {
      threw = true;
      errorMessage = error.message;
    }
    check(`refraction restores all state after ${fail}`, threw === (fail !== "none") && (!threw || errorMessage === fail) && w.mesh.visible && camera.layers.mask === 5 && w.mesh.layers.mask === 9 && w.fire.mesh.layers.mask === 7 && scene.background === background && fake.autoClear && fake.shadowMap.autoUpdate && fake.shadowMap.needsUpdate && target === rt && w.mat.uniforms.uRefractionOn.value === 0);
  }
  check("refraction owns distinct color/depth copies", refraction.size.width === 2400 && w.mat.uniforms.uSceneColor.value !== rt.texture && w.mat.uniforms.uSceneDepth.value !== rt.depthTexture);
  refraction.setQuality("low");
  check("Low disposes refraction targets", refraction.size === null && w.mat.uniforms.uSceneColor.value === null);
  let draw = 0;
  refraction.render(rt, camera, () => draw++);
  check("Low draws once without copy", draw === 1);
  camera.lookAt(0, 30, -50);
  camera.updateMatrixWorld();
  const environment = {
    sunElevation: 4,
    overcast: 0,
    sunDirection: new T.Vector3(0, .07, -1).normalize(),
    sunColor: new T.Color(1, .6, .3)
  };
  const rays = new GodRays(fake, environment, "high");
  fake.render = () => {};
  rays.render(rt, rt.depthTexture, camera);
  check("dawn shafts use a quarter-resolution target", rays.passes === 1 && rays.size.width === 600 && rays.size.height === 300, rays.size);
  environment.sunElevation = 45;
  rays.render(rt, rt.depthTexture, camera);
  check("noon skips the shaft pass", rays.passes === 1);
  rays.setQuality("low");
  check("Low releases the shaft target", rays.size === null);
  const worldA = new T.Scene(), worldB = new T.Scene();
  const airA = installAerialPerspective(worldA), airB = installAerialPerspective(worldB), shared = new T.MeshBasicMaterial();
  const shader = { uniforms: {} };
  shared.onBeforeRender(fake, worldA, camera);
  shared.onBeforeCompile(shader, fake);
  const binding = shader.uniforms.aerialSunTint;
  shared.onBeforeRender(fake, worldB, camera);
  airB.aerialSunTint.value.setRGB(.7, .4, .2);
  check("shared materials rebind when a new world owns them", binding === shader.uniforms.aerialSunTint && binding.value === airB.aerialSunTint.value && binding.value !== airA.aerialSunTint.value);
  rays.dispose();
  refraction.dispose();
  rt.dispose();
  w.dispose();
} finally {
  await server.close();
}
mkdirSync("shots/water", { recursive: true });
writeFileSync("shots/water/unit.json", JSON.stringify({ rows }, null, 2));
process.exitCode = rows.some((r) => !r.pass) ? 1 : 0;
