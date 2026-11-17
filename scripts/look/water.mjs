// BASE_URL is read by measure.openScene. Hardware water shader and real-field proof.
import { launch, openScene, identifyRenderer, saveReport, percentile } from "./measure.mjs";
import { timePasses } from "./pass-times.mjs";
import { bankTools } from "../bankfind.mjs";
const quality = process.env.QUALITY ?? "high", map = process.env.MAP ?? "norcal", mode = process.env.WATER_MODE ?? "after";
const view = process.env.WATER_VIEW ?? "river";
const width = +(process.env.WATER_WIDTH ?? (quality === "low" ? 390 : 1280));
const height = +(process.env.WATER_HEIGHT ?? (quality === "low" ? 844 : 720));
const browser = await launch();
try {
  const { page, errs } = await openScene(browser, {
    scene: map,
    quality,
    width,
    height,
    phone: quality === "low"
  });
  const consoleErrors = [], infrastructureWarnings = [], shaderWarnings = [];
  page.on("console", (m) => {
    const message = m.text();
    if (m.type() === "warning") shaderWarnings.push(message);
    else if (m.type() === "error" && message.startsWith("Failed to send error to Vite server:") && message.includes("@vite/client")) infrastructureWarnings.push(message);
    else if (m.type() === "error") consoleErrors.push(message);
  });
  const renderer = await page.evaluate(identifyRenderer, true);
  const setup = await page.evaluate(async ({ view, bankSource }) => {
    const g = window.__game;
    const river = g.map.rivers[0];
    let point;
    for (let i = Math.floor(river.length * .55); i < river.length; i++) {
      const p = river[i];
      if (Math.abs(p.x) < 2800 && Math.abs(p.z) < 2800 && g.terrain.h(p.x, p.z) < -.5) {
        point = p;
        break;
      }
    }
    if (!point) throw Error("No actual river point");
    if (view === "coast") {
      const tools = new Function(`return ${bankSource}`)()(g.terrain);
      const bank = tools.find(g.startView(), {
        coast: g.map.def.id !== "appalachia",
        maxSlope: 1 / 3
      });
      if (!bank) throw Error("No actual shoreline contour");
      point = {
        x: bank.x - bank.nx * 12,
        z: bank.z - bank.nz * 12
      };
      g.rts.setView(point.x, point.z, 120, Math.atan2(bank.nx, bank.nz), .72, true);
    } else g.rts.setView(point.x, point.z, 170, .85, 1.15, true);
    for (const el of document.querySelectorAll(".hud,.xfeed,.toast,.next-bar,.side-cards")) el.style.display = "none";
    g.hour = 13;
    g.weather.force("clear", 30);
    g.weather.settle();
    for (let i = 0; i < 24; i++) g.frame(1 / 60);
    const terrainHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", g.terrain.heights.buffer))].map((n) => n.toString(16).padStart(2, "0")).join("");
    return {
      point,
      terrainHash,
      camera: {
        position: g.camera.position.toArray(),
        quaternion: g.camera.quaternion.toArray()
      },
      height: g.terrain.h(point.x, point.z),
      triangles: g.water.mesh.geometry.index.count / 3,
      refraction: g.waterRefraction ? {
        size: g.waterRefraction.size,
        copies: g.waterRefraction.copies,
        waterDraws: g.waterRefraction.waterDraws
      } : null,
      reflection: g.water.reflection ? {
        width: g.water.reflection.rt.width,
        height: g.water.reflection.rt.height
      } : null,
      drawBuffer: [g.renderer.domElement.width, g.renderer.domElement.height],
      glError: g.renderer.getContext().getError()
    };
  }, {
    view,
    bankSource: bankTools.toString()
  });
  const stem = `shots/water/${map}-${view}-${quality}-${mode}`;
  await page.screenshot({ path: `${stem}-clean.png` });
  const cdp = quality === "low" ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const timings = await page.evaluate(() => {
    const t = [];
    for (let i = 0; i < 90; i++) {
      const start = performance.now();
      window.__game.frame(1 / 60);
      t.push(performance.now() - start);
    }
    return t;
  });
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const gpu = await page.evaluate(timePasses, 8);
  const fields = [];
  if (mode === "after" && view === "river") for (const level of [
    .4,
    1.2,
    2.2,
    4,
    0
  ]) {
    const state = await page.evaluate(async ({ point, level }) => {
      const g = window.__game;
      const { airFields } = await import("/src/sim/services.ts");
      const { TUNING } = await import("/src/sim/tuning.ts");
      const F = airFields();
      // Controlled field-source fixture: real emission/transport API, not shader
      // uniforms or a claim that this fresh town naturally reached these levels.
      F.load([]);
      for (let z = point.z - 256; z <= point.z + 256; z += 32) for (let x = point.x - 256; x <= point.x + 256; x += 32) F.addEmission(x, z, level * TUNING.smogCell / 4 / .93);
      F.stepPollution(1, 0, 0);
      g.sim.day += 1;
      g.water.updateFields(g.fields);
      for (let i = 0; i < 5; i++) g.frame(1 / 60);
      return {
        requested: level,
        actual: g.fields.pollutionAt(point.x, point.z),
        smog: g.fields.smog(),
        flames: g.water.fire.count,
        uploads: g.water.pollution.uploads,
        glError: g.renderer.getContext().getError()
      };
    }, {
      point: setup.point,
      level
    });
    fields.push(state);
    await page.screenshot({ path: `${stem}-pollution-${level}.png` });
  }
  const terrainAfter = await page.evaluate(async () => [...new Uint8Array(await crypto.subtle.digest("SHA-256", window.__game.terrain.heights.buffer))].map((n) => n.toString(16).padStart(2, "0")).join(""));
  const result = {
    map,
    view,
    quality,
    mode,
    terrainUnchanged: terrainAfter === setup.terrainHash,
    cpuThrottle: quality === "low" ? 4 : 1,
    renderer,
    browser: browser.version(),
    setup,
    fields,
    cpu: {
      median: percentile(timings, .5),
      p95: percentile(timings, .95),
      worst: Math.max(...timings)
    },
    gpu,
    errors: errs,
    consoleErrors,
    infrastructureWarnings,
    shaderWarnings
  };
  result.passed = result.terrainUnchanged && !errs.length && !consoleErrors.length && !setup.glError && (mode === "before" || fields.every((x) => x.glError === 0) && (view === "coast" || fields.at(-1).flames === 0 && fields.find((x) => x.requested === 4).flames > 0) && (quality === "low" || quality === "medium" || setup.refraction?.copies > 0));
  saveReport(`${stem}.json`, result);
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
