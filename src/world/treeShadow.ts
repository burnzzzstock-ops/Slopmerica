import * as THREE from 'three';

// A distant directional shadow can use the same species silhouette as the
// visible billboard. In the depth pass its plane faces the sun, so its alpha
// projects onto the ground in the direction of the actual light.
export function treeShadowImpostor(atlas: THREE.Texture, tile: number, tiles: number,
    size: { w: number; h: number; y0: number; yc: number }) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = shader => {
    shader.uniforms.uShadowAtlas = { value: atlas };
    shader.uniforms.uShadowSize = { value: new THREE.Vector4(size.w, size.h, size.y0, size.yc) };
    shader.uniforms.uShadowTile = { value: new THREE.Vector2(tile, tiles) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec4 uShadowSize;
uniform vec2 uShadowTile;
varying vec3 vShadowUv;
varying float vShadowTop;`)
      .replace('#include <project_vertex>', `
int corner = gl_VertexID % 4;
vec2 quad = vec2(float(corner == 1 || corner == 2), float(corner >= 2));

vec3 lightDir = vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z);
vec3 right = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
vec3 up = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
float width = length(instanceMatrix[0].xyz);
float height = length(instanceMatrix[1].xyz);
float treeY = uShadowSize.z + quad.y * uShadowSize.y;
vec3 base = (modelMatrix * instanceMatrix[3]).xyz;
vec3 x = right * ((quad.x - .5) * width * uShadowSize.x);
vShadowTop = smoothstep(.34, .70, lightDir.y);
vec3 side = base + x + vec3(0., treeY * height, 0.);
vec3 top = base + x + vec3(0., uShadowSize.w * height, 0.) + up * ((quad.y - .5) * uShadowSize.y * height);
vec3 world = mix(side, top, vShadowTop);
float vertical = dot(world - base, up) / height;
// The side photograph sits on the ground; the overhead one is centred at
// mid-crown. Project both into the light plane before blending their alpha.
vShadowUv = vec3((uShadowTile.x + quad.x) / uShadowTile.y,
  (vertical / max(.001, up.y) - uShadowSize.z) / uShadowSize.y,
  (vertical - uShadowSize.w * up.y) / uShadowSize.y + .5);
vec4 mvPosition = viewMatrix * vec4(world, 1.);
gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uShadowAtlas;
varying vec3 vShadowUv;
varying float vShadowTop;`)
      .replace('#include <map_fragment>', `
vec2 uvSide = vec2(vShadowUv.x, vShadowUv.y * .5);
float side = texture2D(uShadowAtlas, vec2(uvSide.x, clamp(vShadowUv.y, 0., 1.) * .5)).a * step(0., vShadowUv.y) * step(vShadowUv.y, 1.);
float top = texture2D(uShadowAtlas, vec2(uvSide.x, .5 + clamp(vShadowUv.z, 0., 1.) * .5)).a * step(0., vShadowUv.z) * step(vShadowUv.z, 1.);
vec2 texel = vec2(uvSide.x, mix(vShadowUv.y, vShadowUv.z, vShadowTop) * .5) * vec2(textureSize(uShadowAtlas, 0));
vec2 dx = dFdx(texel), dy = dFdy(texel);
float mip = clamp(.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0., 3.);
if (mix(side, top, vShadowTop) * (1. + .3 * mip) < .30) discard;`)
      .replace('#include <alphatest_fragment>', '');
  };
  material.customProgramCacheKey = () => 'tree-shadow-impostor';
  return material;
}

// Reuse a leaf card's four consecutive vertex IDs. The overview depth shader
// builds the sun-facing quad from their cyclic order. Beauty, reflection and
// close shadow draws retain the original model and its original index range.
export function bindTreeShadowRange(mesh: THREE.InstancedMesh, proxy: THREE.MeshDepthMaterial) {
  const geometry = mesh.geometry;
  const index = geometry.getIndex()!;
  const canopy = geometry.getAttribute('canopy');
  let first = 0;
  for (; first < index.count; first += 6) {
    const a = index.getX(first);
    if (canopy.getX(a) > .5 && index.getX(first + 1) === a + 1 && index.getX(first + 5) === a + 3) break;
  }
  if (first === index.count) return false;
  const { start, count } = geometry.drawRange;
  mesh.onBeforeShadow = (_renderer, _mesh, _camera, _shadowCamera, _geometry, material) => {
    if (material === proxy) geometry.setDrawRange(first, 6);
  };
  mesh.onAfterShadow = () => geometry.setDrawRange(start, count);
  return true;
}
