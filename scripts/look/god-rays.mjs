// BASE_URL is read by measure.openScene. Actual Game dawn rays and quality resources.
import { launch, openScene, identifyRenderer, saveReport } from "./measure.mjs";
import { timePasses } from "./pass-times.mjs";
import { writeFileSync } from "node:fs";
const hardware = process.env.GPU === '1';
const browser = await launch(!hardware);
try {
  const { page, errs } = await openScene(browser, {
    scene: "norcal",
    quality: "high",
    width: 1280,
    height: 720
  });
  const setup = await page.evaluate(() => {
    const g = window.__game;
    g.weather.force("clear", 30);
    g.weather.settle();
    let hour = 6;
    for (let h = 4; h < 11; h += .025) {
      g.env.hour = h;
      g.env.update(0, g.rts.target, g.rts.distance, g.camera.position);
      if (g.env.sunElevation > 3.5 && g.env.sunElevation < 5) {
        hour = h;
        break;
      }
    }
    g.hour = hour;
    const sun = g.env.sunDirection;
    const S = g.startView();
    g.rts.setView(S.x, S.z, 800, Math.atan2(-sun.x, -sun.z), .08, true);
    for (const e of document.querySelectorAll(".hud,.xfeed,.toast,.next-bar,.side-cards")) e.style.display = "none";
    for (let i = 0; i < 16; i++) g.frame(1 / 60);
    return {
      hour,
      elevation: g.env.sunElevation,
      sun: g.env.sunDirection.toArray(),
      passes: g.godRays.passes,
      size: g.godRays.size
    };
  });
  const proof = await page.evaluate(() => {
    const g = window.__game, gl = g.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const off = new Uint8Array(w * h * 4), on = new Uint8Array(w * h * 4);
    // Compare the post effect against the same already-drawn world. A second
    // Game frame can refresh throttled sky/reflection resources between reads.
    g.godRays.enabled = false;
    g.post.gradeM.uniforms.uTime.value = 0;
    g.post.render(0, g.rts.distance);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, off);
    const offImage = g.renderer.domElement.toDataURL("image/png");
    const before = g.godRays.passes;
    g.godRays.enabled = true;
    g.post.gradeM.uniforms.uTime.value = 0;
    g.post.render(0, g.rts.distance);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, on);
    let sum = 0, max = 0, changed = 0;
    for (let i = 0; i < off.length; i += 4) {
      const d = (on[i] - off[i]) * .2126 + (on[i + 1] - off[i + 1]) * .7152 + (on[i + 2] - off[i + 2]) * .0722;
      sum += d;
      max = Math.max(max, d);
      if (d > 1) changed++;
    }
    return {
      offImage,
      passAdded: g.godRays.passes - before,
      meanLumaGain: sum / (w * h),
      maxLumaGain: max,
      changedPixels: changed,
      glError: gl.getError()
    };
  });
  writeFileSync("shots/water/god-rays-high-off.png", Buffer.from(proof.offImage.split(",")[1], "base64"));
  delete proof.offImage;
  await page.screenshot({ path: "shots/water/god-rays-high.png" });
  const gpu = hardware ? await page.evaluate(timePasses, 8) : null;
  const quality = await page.evaluate(() => {
    const g = window.__game;
    g.hour = 13;
    const before = g.godRays.passes;
    g.frame(0);
    const noonSkipped = g.godRays.passes === before;
    const wet = g.map.rivers[0].find((p) => Math.abs(p.x) < 2e3 && Math.abs(p.z) < 2e3 && g.terrain.h(p.x, p.z) < -.5);
    g.rts.setView(wet.x, wet.z, 170, .8, 1.1, true);
    const rows = [];
    for (const name of [
      "low",
      "medium",
      "ultra",
      "high"
    ]) {
      g.requestQuality(name);
      g.frame(0);
      rows.push({
        name,
        post: g.post.active,
        refraction: g.waterRefraction.size,
        rays: g.godRays.size,
        mirror: g.water.reflection ? {
          width: g.water.reflection.rt.width,
          height: g.water.reflection.rt.height
        } : null,
        buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
        glError: g.renderer.getContext().getError()
      });
    }
    return {
      noonSkipped,
      rows
    };
  });
  const renderer = await page.evaluate(identifyRenderer, hardware);
  const low = quality.rows[0], medium = quality.rows[1], ultra = quality.rows[2];
  const result = {
    setup,
    proof,
    gpu,
    quality,
    renderer,
    browser: browser.version(),
    errors: errs
  };
  result.passed = !errs.length && !proof.glError && proof.passAdded === 1 && proof.meanLumaGain > .01 && proof.maxLumaGain < 60 && quality.noonSkipped && !low.refraction && !low.rays && !low.mirror && !medium.refraction && medium.mirror && ultra.mirror.width === ultra.buffer[0] && ultra.mirror.height === ultra.buffer[1] && quality.rows.every((r) => !r.glError);
  saveReport("shots/water/god-rays.json", result);
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
