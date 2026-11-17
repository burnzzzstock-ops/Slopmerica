import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server:{ middlewareMode:true, watch:null, hmr:false, ws:false }, appType:'custom', logLevel:'error' });
try {
  const { RoadRenderer } = await server.ssrLoadModule('/src/roads/roadMesh.ts');
  const { VERGE_RUN, GROUND_BELOW, WALK_TOP, edgeLift } = await server.ssrLoadModule('/src/roads/roadSection.ts');
  const { ROAD_TYPES } = await server.ssrLoadModule('/src/roads/roadTypes.ts');
  const foot = (height, top = WALK_TOP) => RoadRenderer.prototype.bankFoot.call({net:{terrain:{h:height}}},0,0,1,0,top,-GROUND_BELOW-.03);
  const flat = foot(()=>-.35), raised = foot(()=>.1), falling = foot(x=>-.35-.5*x);
  assert.ok(flat.run>=VERGE_RUN&&flat.run<1.5);
  assert.ok(Math.abs(flat.yB+.365)<1e-12);
  assert.ok((WALK_TOP-flat.yB)/flat.run<.4,'ordinary verge falls more gently than1:2.5');
  assert.ok(raised.yB>0,'higher terrain lifts the foot instead of keeping a false deep wall');
  assert.ok(raised.run===VERGE_RUN);
  assert.ok(falling.run<=5&&falling.run>VERGE_RUN);
  assert.ok(Math.abs(falling.yB-(-.35-.5*falling.run-.015))<1e-12,'deep feet meet the actual sampled terrain');
  for (const profile of [flat,raised,falling]) {
    for (const vector of [profile.normal,profile.footNormal]) {
      assert.ok(vector.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...vector)-1)<1e-12);
      assert.ok(vector[1]>0);
    }
  }
  assert.ok(flat.footNormal[1]>flat.normal[1],'foot normal blends toward flat ground');
  for (const road of Object.values(ROAD_TYPES)) {
    const top = edgeLift(road,road.width/2);
    assert.equal(top,road.sidewalk>0?WALK_TOP:.06);
    assert.ok(Math.abs(edgeLift(road,road.width/2+VERGE_RUN)+GROUND_BELOW+.02)<1e-12);
  }
  console.log('PASS gentle flat verges, actual-ground feet, bounded hillside banks, unit normals and shared prop heights');
} finally { await server.close(); }
