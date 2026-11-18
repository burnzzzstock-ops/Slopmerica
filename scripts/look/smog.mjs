// BASE_URL serves a frozen build. SMOG_CITY is an actual normally grown town.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSave } from "../lib/fixtures.mjs";
import { seededInit, seededRandom } from "../refblock.mjs";
import { launch, openScene, identifyRenderer, saveReport } from "./measure.mjs";
const fixture = process.env.SMOG_CITY ?? "shots/fixtures/large-town-downtown-healthy/town.json.gz";
const text = readSave(fixture), hash = createHash("sha256").update(text).digest("hex");
const manifest = JSON.parse(readFileSync(fixture.replace("town.json.gz", "manifest.json"), "utf8"));
const center = manifest.layout.center, quality = process.env.QUALITY ?? "high";
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const browser = await launch(), rows = [], errors = [];
let renderer, pinned;
try {
  for (const mode of ["pristine", "city"]) {
    let page;
    if (mode === "pristine") ({page} = await openScene(browser, {
      scene: "norcal",
      quality,
      width: 1280,
      height: 720
    }));
    else {
      page = await browser.newPage({ viewport: {
        width: 1280,
        height: 720
      } });
      await page.addInitScript(seededInit, {
        seed: 1776,
        rng: seededRandom.toString()
      });
      await page.goto(`${base}/package.json`);
      await page.evaluate(async ({ text, quality }) => {
        const { packString } = await import("/src/core/lz.ts");
        localStorage.setItem("slopmerica.save.v1", text.startsWith("{") ? packString(text) : text);
        localStorage.setItem("slopmerica.quality", quality);
        localStorage.setItem("slopmerica.onboarded", "1");
        localStorage.setItem("slopmerica.firstSteps", "1");
      }, {
        text,
        quality
      });
      await page.goto(base, {
        waitUntil: "load",
        timeout: 18e4
      });
      await page.locator("#continue").click({ timeout: 24e4 });
      await page.waitForFunction(() => window.__game && window.__game.civic.status !== "loading", null, { timeout: 3e5 });
    }
    page.on("pageerror", (e) => errors.push(e.message));
    renderer = await page.evaluate(identifyRenderer, true);
    pinned = await page.evaluate(({ center, pinned }) => {
      const g = window.__game;
      g.stop();
      g.sim.speed = 0;
      g.sim.day = 100;
      g.sim.lastWhole = 100;
      g.rts.setView(center.x, center.z, 1400, 2.35, .12, true);
      g.rts.update(0);
      if (pinned) {
        g.camera.position.fromArray(pinned.position);
        g.camera.quaternion.fromArray(pinned.quaternion);
        g.rts.target.fromArray(pinned.target);
        g.camera.updateMatrixWorld();
      }
      g.rts.update = () => {};
      g.weather.force("clear", 30);
      g.weather.settle();
      for (const el of document.querySelectorAll(".hud,.xfeed,.toast,.next-bar,.side-cards")) el.style.display = "none";
      return {
        position: g.camera.position.toArray(),
        quaternion: g.camera.quaternion.toArray(),
        target: g.rts.target.toArray()
      };
    }, {
      center,
      pinned
    });
    for (const [name, hour] of [
      ["day", 13],
      ["night", 23],
      ...mode === "city" ? [["emission-proxy", 13]] : []
    ]) {
      if (name === "emission-proxy") await page.evaluate(async () => {
        const { airFields } = await import("/src/sim/services.ts");
        const { TUNING } = await import("/src/sim/tuning.ts");
        const g = window.__game, F = airFields();
        F.load([]);
        for (let z = -3040; z < 3072; z += 64) for (let x = -3040; x < 3072; x += 64) F.addEmission(x, z, 4 * TUNING.smogCell / .93);
        F.stepPollution(1, 0, 0);
        g.sim.day += 1;
        g.water.updateFields(g.fields);
      });
      const state = await page.evaluate((hour) => {
        const g = window.__game;
        g.hour = hour;
        g.env.moonPhaseOverride = 0;
        g.weather.force("clear", 30);
        g.weather.settle();
        for (let i = 0; i < 24; i++) g.frame(1 / 60);
        const c = document.createElement("canvas");
        c.width = g.renderer.domElement.width;
        c.height = g.renderer.domElement.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(g.renderer.domElement, 0, 0);
        const image = ctx.getImageData(0, 0, c.width, c.height).data;
        let red = 0, green = 0, blue = 0, chroma = 0, luma = 0, hx = 0, hy = 0, count = 0;
        for (let y = 8; y < 100; y++) for (let x = 40; x < c.width - 40; x++) {
          const k = (y * c.width + x) * 4, r = image[k] / 255, gg = image[k + 1] / 255, b = image[k + 2] / 255, max = Math.max(r, gg, b), min = Math.min(r, gg, b), d = max - min;
          let h = 0;
          if (d > .001) {
            h = max === r ? (gg - b) / d % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
            h *= Math.PI / 3;
            hx += Math.cos(h) * d;
            hy += Math.sin(h) * d;
          }
          red += r;
          green += gg;
          blue += b;
          chroma += d;
          luma += r * .2126 + gg * .7152 + b * .0722;
          count++;
        }
        const f = g.fields.fieldFor("pollution");
        return {
          population: g.sim.population,
          buildings: g.buildings.list.size,
          cars: g.traffic.cars.length,
          smog: g.fields.smog(),
          environmentSmog: g.env.smog,
          lightPollution: g.env.lightPollution,
          pollutedCells: [...f.data].filter(Number.isFinite).length,
          maxPollution: Math.max(0, ...[...f.data].filter(Number.isFinite)) / f.max,
          sky: {
            rgb: [
              red / count,
              green / count,
              blue / count
            ],
            chroma: chroma / count,
            luma: luma / count,
            hue: (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360,
            count
          },
          camera: {
            position: g.camera.position.toArray(),
            quaternion: g.camera.quaternion.toArray()
          },
          starField: g.env.starU.uVis.value,
          milkyWay: g.env.skyU.uStars.value,
          glError: g.renderer.getContext().getError()
        };
      }, hour);
      await page.screenshot({ path: `shots/water/smog-${quality}-${mode}-${name}.png` });
      rows.push({
        mode,
        name,
        ...state
      });
    }
    await page.close();
  }
  const day = rows.filter((r) => r.name === "day"), night = rows.filter((r) => r.name === "night");
  const result = {
    fixture,
    hash,
    quality,
    renderer,
    browser: browser.version(),
    rows,
    errors,
    proxy: "emission-proxy is a controlled real emission/transport field, not a naturally grown city"
  };
  result.passed = errors.length === 0 && rows.every((r) => r.glError === 0 && Math.abs(r.smog - r.environmentSmog) < 1e-9) && day[1].population >= 5e3 && day[1].pollutedCells > day[0].pollutedCells && day[1].smog >= day[0].smog && JSON.stringify(day[0].camera) === JSON.stringify(day[1].camera) && night[1].milkyWay < night[0].milkyWay && rows.at(-1).smog > .9 && rows.at(-1).sky.rgb[2] / rows.at(-1).sky.rgb[0] < day[0].sky.rgb[2] / day[0].sky.rgb[0] - .2;
  saveReport(`shots/water/smog-${quality}.json`, result);
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
