import { Group, Material, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export interface VaultFamily {id:string;label:string;category:string;description:string;satire:string;tags:string[];signLines:string[];count:number}
export interface VaultLOD {level:number;scene:number;triangles:number;drawCalls:number;bounds:{min:number[];max:number[]}}
export interface VaultAsset {id:string;family:string;variant:number;plan:string;label:string;url:string;dimensions:number[];bounds:{min:number[];max:number[]};lods:VaultLOD[];geometrySignature:string;sockets:{name:string;position:number[]}[];fileBytes:number;sha256:string}
export interface VaultManifest {schemaVersion:number;name:string;version:string;families:VaultFamily[];assets:VaultAsset[];sharedGeometry:{url:string;bytes:number;sha256:string}}
export interface VaultHandle {root:Group;asset:VaultAsset;setLOD(level:0|1|2):void;dispose():void}

/** One glTF asset holds three named LOD scenes. No game simulation is registered. */
export class VaultLibrary {
  private loader=new GLTFLoader();
  private byId:Map<string,VaultAsset>;
  private constructor(readonly base:URL,readonly manifest:VaultManifest){
    this.byId=new Map(manifest.assets.map(a=>[a.id,a]));
  }
  static async open(base=new URL('./asset-vault/',document.baseURI)):Promise<VaultLibrary>{
    const response=await fetch(new URL('manifest.json',base));
    if(!response.ok)throw new Error('Asset vault manifest returned HTTP '+response.status);
    const manifest=await response.json() as VaultManifest;
    if(manifest.schemaVersion!==1||!Array.isArray(manifest.assets)||!Array.isArray(manifest.families))throw new Error('Unsupported asset vault manifest');
    return new VaultLibrary(base,manifest);
  }
  async load(id:string,level:0|1|2=0):Promise<VaultHandle>{
    const asset=this.byId.get(id);if(!asset)throw new Error('Unknown vault asset '+id);
    if(![0,1,2].includes(level))throw new Error('LOD must be 0, 1, or 2');
    const gltf=await this.loader.loadAsync(new URL(asset.url,this.base).href);
    const root=new Group();root.name=id;
    let disposed=false;
    gltf.scenes.forEach(scene=>scene.traverse(object=>{if(object instanceof Mesh){object.castShadow=true;object.receiveShadow=true;}}));
    const handle:VaultHandle={
      root,asset,
      setLOD(lod){
        if(disposed)throw new Error('This asset has been disposed');
        if(![0,1,2].includes(lod)||!gltf.scenes[lod])throw new Error('Missing LOD '+lod);
        root.clear();root.add(gltf.scenes[lod]);root.userData.assetId=id;root.userData.lod=lod;
      },
      dispose(){
        if(disposed)return;disposed=true;root.clear();
        const materials=new Set<Material>(),textures=new Set<Texture>(),geometries=new Set<Mesh['geometry']>();
        gltf.scenes.forEach(scene=>scene.traverse(object=>{
          if(!(object instanceof Mesh))return;geometries.add(object.geometry);
          for(const material of Array.isArray(object.material)?object.material:[object.material]){
            materials.add(material);for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
          }
        }));
        geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());
      },
    };
    handle.setLOD(level);return handle;
  }
}
