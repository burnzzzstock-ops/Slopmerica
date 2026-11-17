// BASE_URL serves source; this controlled WebGL scene validates real color/depth copies.
import { launch, saveReport } from "./measure.mjs";
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const browser = await launch(process.env.GPU !== '1');
try {
  const page = await browser.newPage({ viewport: {
    width: 640,
    height: 480
  } }), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/package.json`);
  const result = await page.evaluate(async () => {
    const source = await (await fetch("/src/render/post.ts")).text();
    const T = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { PostFX } = await import("/src/render/post.ts");
    const { createWater } = await import("/src/world/water.ts");
    const { WaterRefraction } = await import("/src/render/refraction.ts");
    const { QUALITY } = await import("/src/config.ts");
    const renderer = new T.WebGLRenderer({
      antialias: false,
      preserveDrawingBuffer: true
    });
    renderer.setSize(640, 480);
    document.body.replaceChildren(renderer.domElement);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info"), adapter = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(50, 640 / 480, .1, 1e3);
    camera.position.set(0, 10, 16);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    scene.background = new T.Color(8426920);
    const heights = new Float32Array(1537 ** 2).fill(-4), texData = new Float32Array([-4]);
    const heightTex = new T.DataTexture(texData, 1, 1, T.RedFormat, T.FloatType);
    heightTex.needsUpdate = true;
    const terrain = {
      heights,
      heightTex,
      h: () => texData[0],
      map: { rivers: [] }
    };
    const water = createWater(terrain, {
      shallow: 5217469,
      deep: 1193554,
      murk: 7829316
    }, false, "norcal");
    scene.add(water.mesh);
    water.mat.uniforms.uSunColor.value.setRGB(0, 0, 0);
    water.mat.uniforms.uSunDir.value.set(0, 1, 0);
    water.mat.uniforms.uSky.value.setRGB(0, 0, 0);
    water.mat.uniforms.uSkyTop.value.setRGB(0, 0, 0);
    water.mat.uniforms.uWindAmp.value = 0;
    const bed = new T.Mesh(new T.PlaneGeometry(150, 150), new T.MeshBasicMaterial({ color: 16777215 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -4;
    scene.add(bed);
    const pole = new T.Mesh(new T.BoxGeometry(1.5, 8, 1.5), new T.MeshBasicMaterial({ color: 16711935 }));
    pole.position.set(-4, 3, 0);
    scene.add(pole);
    const post = new PostFX(renderer, scene, camera, {
      ...QUALITY.high,
      ao: false
    });
    post.setSize(640, 480);
    post.bloomOn = false;
    post.vignette = false;
    post.look.contrast = 1;
    const refraction = new WaterRefraction(renderer, scene, water.mesh, "high");
    post.scenePass = refraction.render;
    const read = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, 640, 480).data;
    };
    const center = (d) => {
      let sum = 0, n = 0;
      for (let y = 225; y < 255; y++) for (let x = 305; x < 335; x++) {
        let k = (y * 640 + x) * 4;
        sum += d[k] * .2126 + d[k + 1] * .7152 + d[k + 2] * .0722;
        n++;
      }
      return sum / n;
    };
    const rows = [];
    for (const depth of [
      .5,
      4,
      12
    ]) {
      bed.position.y = -depth;
      texData[0] = -depth;
      heightTex.needsUpdate = true;
      for (let i = 0; i < 3; i++) post.render(0, 20);
      rows.push({
        depth,
        luma: center(read()),
        copySize: refraction.size,
        glError: gl.getError()
      });
    }
    const submerged = read();
    water.mesh.visible = false;
    post.render(0, 20);
    const without = read();
    water.mesh.visible = true;
    let polePixels = 0, poleMaxDifference = 0;
    const above = new T.Vector3(-4, 1.5, 0).project(camera), cutY = Math.floor((1 - above.y) * 240);
    for (let k = 0; k < without.length; k += 4) if (Math.floor(k / 4 / 640) < cutY && without[k] > 150 && without[k + 2] > 150 && without[k + 1] < 70) {
      polePixels++;
      poleMaxDifference = Math.max(poleMaxDifference, Math.abs(submerged[k] - without[k]), Math.abs(submerged[k + 1] - without[k + 1]), Math.abs(submerged[k + 2] - without[k + 2]));
    }
    const copyTexturesDistinct = water.mat.uniforms.uSceneColor.value !== post.sceneRT.texture && water.mat.uniforms.uSceneDepth.value !== post.sceneRT.depthTexture;
    post.render(0, 20);
    window.__optics = {
      renderer,
      water,
      post,
      refraction
    };
    return {
      adapter,
      rows,
      polePixels,
      poleMaxDifference,
      copyTexturesDistinct,
      copies: refraction.copies,
      draws: refraction.waterDraws,
      passed: rows.every((r) => !r.glError) && rows[0].luma > rows[1].luma + 5 && rows[1].luma > rows[2].luma + 5 && polePixels > 100 && poleMaxDifference < 2 && copyTexturesDistinct
    };
  });
  result.errors = errors;
  result.passed &&= !errors.length;
  saveReport("shots/water/optics.json", result);
  await page.screenshot({ path: "shots/water/optics.png" });
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
