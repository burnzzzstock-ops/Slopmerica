// Test-only geometry masks: preserve the actual alpha discard, billboard
// deformation and scene depth. Ground shadows never become tree pixels.
export async function installTreeMask(page) {
  await page.evaluate(async () => {
    const g = window.__game, trees = g.trees;
    const source = await (await fetch('/src/world/trees.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const {coverageMipmaps} = await import('/src/world/foliage.ts');
    const near = new Set(trees.near), far = new Set(trees.far);
    // Photograph the same foliage geometry into the same two-view atlas.
    // The canopy attribute makes leaves white and woody geometry black.
    const geometries = trees.far.map((_, kind) => {
      const geometry = trees.near[kind * 3].geometry.clone();
      const colors = geometry.getAttribute('color'), canopy = geometry.getAttribute('canopy');
      for (let i = 0; i < colors.count; i++) colors.setXYZ(i, canopy.getX(i) > .5 ? 1 : 0, canopy.getX(i) > .5 ? 1 : 0, canopy.getX(i) > .5 ? 1 : 0);
      return geometry;
    });
    // A binary canopy pass is independent of the production bake's lighting
    // and transfer function. Keep its alpha test and photograph geometry.
    const render = g.renderer.render, read = g.renderer.readRenderTargetPixels;
    const maskMaterials = new Map();
    let atlas, rawPixels;
    try {
      g.renderer.readRenderTargetPixels = function(...args) {
        const result = read.apply(this, args);
        rawPixels = args[5].slice();
        return result;
      };
      g.renderer.render = function(scene, camera) {
        const restored = [];
        scene.traverse(object => {
          if (!object.isMesh) return;
          const original = object.material;
          let material = maskMaterials.get(original);
          if (!material) {
            material = original.clone();
            material.onBeforeCompile = (shader, renderer) => {
              original.onBeforeCompile(shader, renderer);
              shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float testCanopy;\nvarying float vTestCanopy;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTestCanopy = testCanopy;');
              shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vTestCanopy;')
                .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = vec3(step(.5, vTestCanopy));');
            };
            material.customProgramCacheKey = () => original.customProgramCacheKey() + '|binary-canopy';
            maskMaterials.set(original, material);
          }
          object.geometry.setAttribute('testCanopy', object.geometry.getAttribute('canopy'));
          restored.push([object, original]);
          object.material = material;
        });
        try { return render.call(this, scene, camera); }
        finally { restored.forEach(([object, material]) => { object.material = material; }); }
      };
      atlas = trees.bakeSprites(g.renderer, geometries, trees.near[0].material.map);
      // Use the binary photograph before production colour normalization,
      // padding and quantization. Otherwise a colour-only bake change can
      // move the threshold of the test mask at a black/white border.
      atlas.image.data = rawPixels;
      atlas.mipmaps = coverageMipmaps(rawPixels, atlas.image.width, atlas.image.height, 256, 512, .3);
      atlas.needsUpdate = true;
    } finally {
      g.renderer.render = render;
      g.renderer.readRenderTargetPixels = read;
      maskMaterials.forEach(material => material.dispose());
    }
    geometries.forEach(geometry => geometry.dispose());
    const pairs = [], cache = new Map();
    g.scene.traverse(object => {
      if (!object.material) return;
      const kind = near.has(object) ? 'near' : far.has(object) ? 'far' : 'other';
      const make = original => {
        const key = original.uuid + kind;
        if (cache.has(key)) return cache.get(key);
        const material = original.clone();
        const before = original.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
          before.call(original, shader, renderer);
          let mask = '0.0';
          if (kind === 'near') mask = 'step(0.5, vCanopy)';
          if (kind === 'far') {
            shader.uniforms.tTestCrownMask = { value: atlas };
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tTestCrownMask;');
            mask = 'step(0.001, dot(mix(texture2D(tTestCrownMask, vec2(vMapUv.x, vMapUv.y * .5)).rgb, texture2D(tTestCrownMask, vec2(vMapUv.x, .5 + vMapUv.y * .5)).rgb, vK), vec3(1.0)))';
          }
          const output = `gl_FragColor = vec4(vec3(${mask}), 1.0);`;
          if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
            shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + output);
          } else {
            const end = shader.fragmentShader.lastIndexOf('}');
            shader.fragmentShader = shader.fragmentShader.slice(0, end) + output + shader.fragmentShader.slice(end);
          }
        };
        material.customProgramCacheKey = () => original.customProgramCacheKey() + '|tree-mask-' + kind;
        cache.set(key, material);
        return material;
      };
      pairs.push({ object, original: object.material, mask: Array.isArray(object.material) ? object.material.map(make) : make(object.material) });
    });
    const size = g.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 0 });
    const data = new Uint8Array(size.x * size.y * 4);
    window.__treeMask = () => {
      const renderer = g.renderer;
      const savedTarget = renderer.getRenderTarget(), background = g.scene.background;
      const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      try {
        pairs.forEach(pair => { pair.object.material = pair.mask; });
        g.scene.background = new THREE.Color(0);
        renderer.shadowMap.autoUpdate = false;
        renderer.setClearColor(0, 1);
        renderer.setRenderTarget(target); renderer.clear();
        renderer.render(g.scene, g.rts.camera);
        renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, data);
        const canvas = document.createElement('canvas'); canvas.width = size.x; canvas.height = size.y;
        const context = canvas.getContext('2d'), pixels = context.createImageData(size.x, size.y);
        for (let y = 0; y < size.y; y++) pixels.data.set(data.subarray(y * size.x * 4, (y + 1) * size.x * 4), (size.y - 1 - y) * size.x * 4);
        context.putImageData(pixels, 0, 0);
        return canvas.toDataURL().split(',')[1];
      } finally {
        pairs.forEach(pair => { pair.object.material = pair.original; });
        g.scene.background = background;
        renderer.shadowMap.autoUpdate = shadowUpdate;
        renderer.setClearColor(clear, alpha); renderer.setRenderTarget(savedTarget);
      }
    };
  });
}
