import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), cacheDir: 'shots/tmp/vite/construction-' + process.pid, configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let failures = 0;
function check(name, pass) {
  console.log(pass ? 'OK' : 'FAIL', name);
  if (!pass) failures++;
}
try {
  const [THREE, { BuildingClip, constructionHeight }, { constructionFrame }] = await Promise.all([
    server.ssrLoadModule('three'),
    server.ssrLoadModule('/src/render/buildingClip.ts'),
    server.ssrLoadModule('/src/render/constructionFrame.ts'),
  ]);
  const clip = new BuildingClip(4);
  clip.set(1, 4.25);
  clip.set(1000, 38.125);
  check('table growth retains existing handles and new height', clip.get(1) === 4.25 && clip.get(1000) === 38.125);
  check('unused handles remain fully open', !clip.active(0) && !clip.active(500));
  clip.set(1, null);
  check('a reused handle starts unclipped', !clip.active(1));
  for (const height of [4, 10.2, 17, 63.7, 111.70677, 192]) {
    const values = Array.from({ length: 1001 }, (_, i) => constructionHeight(height, i / 1000));
    check(`floor reveal is bounded and monotonic at ${height} m`, values.every((value, i) => value >= .2 && value <= height + 1e-6 && (!i || value >= values[i - 1])) && Math.abs(values.at(-1) - height) < 1e-6);
  }
  check('a floor holds its height before the next rise', constructionHeight(17, .24) === constructionHeight(17, .29));

  const material = new THREE.MeshStandardMaterial();
  let chained = 0;
  material.onBeforeCompile = shader => { chained++; shader.uniforms.existingWear = { value: .18 }; };
  clip.bind(material);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  check('clipping preserves prior material hooks and uniforms', chained === 1 && shader.uniforms.existingWear.value === .18);
  const first = shader.uniforms.tBuildingClip.value;
  const secondClip = new BuildingClip(8);
  secondClip.bind(material);
  secondClip.activate();
  check('shared material selects the active batch table', shader.uniforms.tBuildingClip.value !== first);
  clip.activate();
  check('shared material can restore the previous batch', shader.uniforms.tBuildingClip.value === first);

  const frame = constructionFrame(2, 3, 17, 123);
  const position = frame.getAttribute('position');
  const heights = frame.getAttribute('buildClipY');
  let plates = 0, steel = 0;
  for (let i = 0; i < position.count; i++) {
    if (heights.getX(i) < 0) steel++;
    else if (Math.abs(heights.getX(i) - position.getY(i)) < 1e-6) plates++;
  }
  check('scaffold and crane stay fixed while five floor plates reveal', steel > 0 && plates === 5 * 4 && steel + plates === position.count);
  check('construction geometry is finite and indexed', !!frame.index && Object.values(frame.attributes).every(a => Array.from(a.array).every(Number.isFinite)));
  frame.dispose();
} finally {
  await server.close();
}
process.exitCode = failures ? 1 : 0;
