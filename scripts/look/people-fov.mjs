// BASE_URL points to a frozen game. Exercise FOV through Game.frame, where the
// live pedestrian renderer updates its LOD before it rebuilds the draw lists.
import { launch, openScene, presets, selection, saveReport } from './measure.mjs';
const browser = await launch();
const rows = [];
try {
  for (const quality of selection('PRESETS', presets)) {
    const { page } = await openScene(browser, { scene: 'norcal', quality, width: 390, height: 844, phone: true });
    const result = await page.evaluate(() => {
      const g = window.__game, r = g.peds.renderer;
      g.sim.speed = 0;
      const point = g.startView();
      g.rts.setView(point.x, point.z, 80, 2.4, 0.4, true);
      g.frame(0);
      const citizens = JSON.stringify(g.peds.peds.map(p => [p.id, p.x, p.y, p.z, p.phase, p.action]));
      const samples = [], handles = [];
      const direction = g.camera.position.clone();
      g.camera.getWorldDirection(direction);
      const set = (h, distance) => {
        const p = g.camera.position.clone().addScaledVector(direction, distance);
        r.set(h, p.x, p.y - 1, p.z, 0, 'idle', 0);
      };
      for (const fov of [35, 50, 110]) {
        g.camera.fov = fov;
        g.camera.updateProjectionMatrix();
        for (const distance of [10, 20, 30, 39, 45, 55, 70]) {
          const h = r.add(0, distance + 17);
          if (h < 0) throw Error('No renderer handles available');
          handles.push(h);
          set(h, distance);
        }
        r.flush([g.camera]);
        g.frame(0);
        // Fresh people have no previous near state. Step outside and back to
        // remove hysteresis from the initial expected-range assertion.
        for (const h of handles) set(h, 150);
        g.frame(0);
        [10, 20, 30, 39, 45, 55, 70].forEach((d, i) => set(handles[i], d));
        g.frame(0);
        const lists = r.listHandles();
        const near = lists.near.filter(h => handles.includes(h)).length;
        const visible = [...lists.near, ...lists.far].filter(h => handles.includes(h));
        const expectedRange = g.q.peopleNear * Math.tan(25 * Math.PI / 180) / Math.tan(fov * Math.PI / 360);
        const expected = [10, 20, 30, 39, 45, 55, 70].filter(d => d <= expectedRange).length;
        if (!Number.isFinite(r.detail.near) || Math.abs(r.detail.near - expectedRange) > 1e-8 || near !== expected) {
          throw Error(`FOV ${fov}: near ${near}/${expected}, range ${r.detail.near}/${expectedRange}`);
        }
        if (visible.length !== handles.length || new Set(visible).size !== handles.length) throw Error('LOD omitted or duplicated a person');
        samples.push({ fov, near, far: visible.length - near, range: r.detail.near });
        for (const h of handles) r.remove(h);
        handles.length = 0;
      }
      g.camera.fov = 50;
      g.camera.updateProjectionMatrix();
      g.frame(0);
      const h = r.add(0, 919), decisions = [];
      for (const factor of [0.99, 1.05, 1.12, 1.05, 0.98]) {
        set(h, g.q.peopleNear * factor);
        g.frame(0);
        const lists = r.listHandles();
        decisions.push(lists.near.includes(h));
        if (Number(lists.near.includes(h)) + Number(lists.far.includes(h)) !== 1) throw Error('Missing or duplicate transitional person');
      }
      r.remove(h);
      if (String(decisions) !== 'true,true,false,false,true') throw Error('Unstable LOD transition ' + decisions);
      const unchanged = citizens === JSON.stringify(g.peds.peds.map(p => [p.id, p.x, p.y, p.z, p.phase, p.action]));
      if (!unchanged) throw Error('Rendering test changed simulated citizens');
      return { quality: g.q.name, samples, decisions, unchanged };
    });
    rows.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  saveReport('shots/look/people-fov.json', rows);
} finally { await browser.close(); }
