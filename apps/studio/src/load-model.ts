import {
  STUDIO_CAD_EXPORT_HINT_EXTENSIONS,
  STUDIO_DCC_EXPORT_HINT_EXTENSIONS,
  STUDIO_MESH_EXTENSIONS,
  type StudioMeshExtension,
} from '@sorye/types';
import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three/webgpu';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isMeshExtension(ext: string): ext is StudioMeshExtension {
  return (STUDIO_MESH_EXTENSIONS as readonly string[]).includes(ext);
}

export function isCadBrepExtension(ext: string): boolean {
  return (STUDIO_CAD_EXPORT_HINT_EXTENSIONS as readonly string[]).includes(ext);
}

export function isDccHintExtension(ext: string): boolean {
  return (STUDIO_DCC_EXPORT_HINT_EXTENSIONS as readonly string[]).includes(ext);
}

export const ACCEPT_ATTR = [
  ...STUDIO_MESH_EXTENSIONS.map((e) => `.${e}`),
  ...STUDIO_CAD_EXPORT_HINT_EXTENSIONS.map((e) => `.${e}`),
  ...STUDIO_DCC_EXPORT_HINT_EXTENSIONS.map((e) => `.${e}`),
].join(',');

function geometryToGroup(geometry: BufferGeometry): Object3D {
  const group = new Group();
  geometry.computeVertexNormals();
  (geometry as BufferGeometry & { userData: { studioBare?: boolean } }).userData =
    { ...geometry.userData, studioBare: true };
  group.userData.studioGeometry = geometry;
  return group;
}

function asText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

function hintInsteadOfParse(ext: string): never {
  if (isCadBrepExtension(ext)) {
    throw new Error(
      `${ext.toUpperCase()} is a CAD solid (B-rep), not a mesh. Export STL, GLB, or FBX from your CAD tool, then drop that file here.`,
    );
  }
  if (ext === 'blend') {
    throw new Error(
      'Blender .blend is a native DCC file, not a mesh export. In Blender: File → Export → glTF 2.0 (.glb) or FBX, then drop that file here.',
    );
  }
  throw new Error(
    `Unsupported format .${ext || 'unknown'}. Use GLB, FBX, STL, OBJ, USDZ, DAE, 3DS, PLY, 3MF, or WRL.`,
  );
}

export async function loadModelFromFile(file: File): Promise<Object3D> {
  const ext = fileExtension(file.name);
  if (isCadBrepExtension(ext) || isDccHintExtension(ext) || !isMeshExtension(ext)) {
    hintInsteadOfParse(ext);
  }

  const buffer = await file.arrayBuffer();

  if (ext === 'stl') {
    return geometryToGroup(new STLLoader().parse(buffer));
  }

  if (ext === 'ply') {
    return geometryToGroup(new PLYLoader().parse(buffer));
  }

  if (ext === 'obj') {
    return new OBJLoader().parse(asText(buffer));
  }

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
      loader.parse(buffer, '', (result) => resolve(result), reject);
    });
    return gltf.scene;
  }

  if (ext === '3mf') {
    const loaded = new ThreeMFLoader().parse(buffer);
    if (loaded) return loaded;
    throw new Error('Could not parse 3MF file.');
  }

  if (ext === 'fbx') {
    return new FBXLoader().parse(buffer, '');
  }

  if (ext === 'dae') {
    const result = new ColladaLoader().parse(asText(buffer), '');
    if (!result?.scene) throw new Error('Could not parse Collada (DAE) file.');
    return result.scene;
  }

  if (ext === '3ds') {
    return new TDSLoader().parse(buffer, '');
  }

  if (ext === 'usdz' || ext === 'usd' || ext === 'usda') {
    const loaded = new USDLoader().parse(ext === 'usda' ? asText(buffer) : buffer);
    if (loaded) return loaded;
    throw new Error('Could not parse USD/USDZ file.');
  }

  if (ext === 'wrl' || ext === 'vrml') {
    return new VRMLLoader().parse(asText(buffer), '');
  }

  throw new Error('Unsupported format.');
}

/** Small mechanical stand-in so orbit/zoom can be tried without a file. */
export function createSamplePart(): Object3D {
  const group = new Group();
  const base = new Mesh(new CylinderGeometry(1.1, 1.1, 0.18, 48));
  base.position.y = 0.09;
  const boss = new Mesh(new CylinderGeometry(0.42, 0.48, 0.7, 32));
  boss.position.y = 0.53;
  const neck = new Mesh(new CylinderGeometry(0.22, 0.22, 0.85, 24));
  neck.position.y = 1.18;
  const head = new Mesh(new BoxGeometry(0.55, 0.22, 0.55));
  head.position.y = 1.68;
  const tab = new Mesh(new BoxGeometry(1.7, 0.12, 0.38));
  tab.position.set(0, 0.16, 0);
  for (const mesh of [base, boss, neck, head, tab]) {
    group.add(mesh);
  }
  return group;
}
