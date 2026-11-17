// BASE_URL and NEXT_URL select source-isolated builds with the same frozen town.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { REFBLOCK_CENTER } from '../lib/fixtures.mjs';
import { capture, shots } from './golden-scenes.mjs';
import { comparePixels } from './golden-diff.mjs';

const urls = [process.env.BASE_URL || 'http://127.0.0.1:5173'];
if (process.env.NEXT_URL) urls.push(process.env.NEXT_URL);
const center = JSON.parse(readFileSync(REFBLOCK_CENTER,'utf8'));
const out = process.env.OUT || 'shots/terrain-banks';
mkdirSync(out,{recursive:true});
const results = [];
const browser = await launch();
try {
  for (const [index,base] of urls.entries()) for (const quality of ['low','high']) {
    const label = index === urls.length-1 ? 'after' : 'before';
    const shot = shots.find(shot=>shot.id===`block-${quality}-junction-noon`);
    await capture(browser,shot,base,false,async (page,initial) => {
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
      writeFileSync(join(out,`${label}-${quality}-junction.png`),initial.png);
      const report = await page.evaluate(async center => {
        const g = window.__game;
        const { RoadRenderer } = await import('/src/roads/roadMesh.ts');
        const { ROAD_TYPES } = await import('/src/roads/roadTypes.ts');
        const slopes = [], runs = [], depths = [];
        for (const segment of g.net.segs.values()) {
          const road = ROAD_TYPES[segment.type];
          if (!road.sidewalk || segment.over) continue;
          const frame = RoadRenderer.frame(segment,segment.length*.5);
          if (frame.y-frame.ground>2.6 || Math.hypot(frame.p.x-center.x,frame.p.z-center.z)>600) continue;
          for (const side of [-1,1]) {
            const ox=-frame.t.z*side,oz=frame.t.x*side,top=frame.y+.18;
            const foot=g.roads.bankFoot(frame.p.x+ox*road.width/2,frame.p.z+oz*road.width/2,ox,oz,top,frame.y-.38);
            slopes.push((top-foot.yB)/foot.run);runs.push(foot.run);depths.push(top-foot.yB);
          }
        }
        const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
        const hash = arrays => {
          let value=2166136261;
          for(const array of arrays)for(const byte of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))value=Math.imul(value^byte,16777619)>>>0;
          return value.toString(16);
        };
        const asphalt=[...g.roads.typeMeshes.values(),g.roads.junctionMesh,g.roads.crosswalkMesh];
        const roadArrays=asphalt.flatMap(mesh=>['position','normal','uv'].map(name=>mesh.geometry.attributes[name]?.array).concat(mesh.geometry.index?.array)).filter(Boolean);
        const geos=new Set(g.terrain.chunks.flatMap(chunk=>chunk.geos).filter(Boolean));
        let paintBytes=0;
        for(const geometry of geos)paintBytes+=geometry.attributes.paintDelta?.array.byteLength??0;
        const stats={population:g.sim.population,buildings:g.buildings.list.size,calls:g.perf.calls,triangles:g.perf.triangles,
          terrainHash:hash([g.terrain.heights,g.terrain.paint]),asphaltHash:hash(roadArrays),samples:slopes.length,
          medianSlope:median(slopes),maxSlope:Math.max(...slopes),medianRun:median(runs),medianDepth:median(depths),paintBytes};
        const copy = () => {
          const canvas=document.createElement('canvas');
          canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;
          canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0,canvas.width,canvas.height);
          return canvas.toDataURL().split(',')[1];
        };
        g.rts.setView(center.x-25,center.z-25,65,2.4,.45,true);
        g.env.envT=-Infinity;g.env.envKey='';
        for(let frame=0;frame<4;frame++)g.frame(0);
        const bankPng=copy();
        // A controlled circle uses the ordinary ground-paint entry point. The
        // underlying heightfield and material remain the actual town terrain.
        const x=center.x+35,z=center.z+35;
        g.terrain.paintCircle(x,z,75,0);
        g.terrain.paintCircle(x,z,22,1);
        g.rts.setView(x,z,85,.3,1.15,true);
        for(let frame=0;frame<6;frame++)g.frame(0);
        const terrainMeshes=new Set();g.terrain.group.traverse(object=>{if(object.isMesh)terrainMeshes.add(object);});
        g.scene.traverse(object=>{if((object.isMesh||object.isLine)&&!terrainMeshes.has(object))object.visible=false;});
        g.renderer.render(g.scene,g.camera);
        return {...stats,bankPng,paintPng:copy(),paintedTerrainHash:hash([g.terrain.heights,g.terrain.paint])};
      },center);
      const {bankPng,paintPng,...stats}=report;
      writeFileSync(join(out,`${label}-${quality}-bank.png`),Buffer.from(bankPng,'base64'));
      writeFileSync(join(out,`${label}-${quality}-paint.png`),Buffer.from(paintPng,'base64'));
      results.push({label,quality,...stats,errors});
      writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
      console.log(label,quality,JSON.stringify(stats));
      assert.deepEqual(errors,[]);
      assert.ok(stats.samples>20);
      const before=results.find(row=>row.label==='before'&&row.quality===quality);
      if(label==='after'&&before) {
        for(const key of ['population','buildings','terrainHash','asphaltHash','paintedTerrainHash','calls','triangles'])assert.equal(stats[key],before[key],key+' differs across the pair');
        assert.ok(stats.medianSlope<before.medianSlope,'verges must become gentler');
        assert.ok(stats.medianRun>before.medianRun,'verges must extend into the ground');
        assert.ok(stats.paintBytes>0);
      }
    },process.env.GPU==='1'?'hardware':'swiftshader');
  }
  if (urls.length === 2) {
    const page = await browser.newPage();
    for (const quality of ['low','high']) {
      const images = ['before','after'].map(label => 'data:image/png;base64,' + readFileSync(join(out,`${label}-${quality}-paint.png`)).toString('base64'));
      const pixels = await page.evaluate(async images => {
        const arrays=[];
        for (const source of images) {
          const image=new Image();image.src=source;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
          const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
          const bytes=context.getImageData(0,0,image.width,image.height).data,chunks=[];
          for(let offset=0;offset<bytes.length;offset+=16384)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+16384)));
          arrays.push(btoa(chunks.join('')));
        }
        return arrays;
      },images);
      const {diff,...comparison}=comparePixels(...pixels.map(value=>Buffer.from(value,'base64')));
      assert.ok(comparison.changed>0,'paint boundary shader must visibly change the controlled patch');
      results.find(row=>row.label==='after'&&row.quality===quality).paintComparison=comparison;
      console.log(quality,'paint boundary',JSON.stringify(comparison));
    }
    await page.close();
    writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
  }
} finally { await browser.close(); }
console.log('PASS unchanged height/paint/asphalt, gentler bank geometry and terrain shaders');
