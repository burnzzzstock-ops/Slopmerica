import { Group, Material, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface AssetLOD { level: number; url: string; triangles: number; drawCalls: number; bufferBytes: number; sha256: string }
export interface AssetEntry {
  id: string; label: string; category: string; description: string; style: string;
  bounds: { min: number[]; max: number[] }; dimensions: number[]; materials: string[];
  sockets: { name: string; position: number[] }[]; lods: AssetLOD[];
}
export interface AssetManifest {
  schemaVersion: number; name: string; version: string;
  assets: AssetEntry[]; materials: { id: string; label: string; albedo: string; normal: string; orm: string }[];
}

/** Loads standard glTF exports. Caller owns and disposes each returned scene. */
export class CivicLibrary {
  private loader = new GLTFLoader();
  private constructor(readonly base: URL, readonly manifest: AssetManifest) {}
  static async open(base = new URL('./asset-library/', document.baseURI)): Promise<CivicLibrary> {
    const response = await fetch(new URL('manifest.json', base));
    if (!response.ok) throw new Error('Cannot load asset manifest (' + response.status + ')');
    const manifest = await response.json() as AssetManifest;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new Error('Unsupported asset manifest');
    return new CivicLibrary(base, manifest);
  }
  async load(id: string, lod: 0 | 1 | 2 = 0): Promise<Group> {
    const entry = this.manifest.assets.find(a => a.id === id);
    if (!entry) throw new Error('Unknown asset: ' + id);
    const variant = entry.lods.find(l => l.level === lod);
    if (!variant) throw new Error('Missing LOD ' + lod + ' for ' + id);
    const gltf = await this.loader.loadAsync(new URL(variant.url, this.base).href);
    gltf.scene.userData.assetId = id;
    gltf.scene.userData.lod = lod;
    gltf.scene.traverse(o => { if (o instanceof Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    return gltf.scene;
  }
}

/** For independently loaded scenes only; do not dispose resources still used by clones. */
export function disposeAsset(root: Group): void {
  const materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(o => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
}
