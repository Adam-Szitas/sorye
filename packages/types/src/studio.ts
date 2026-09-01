/** Studio — client-side 3D / CAD viewing limits (Too-much monitor). */

export const STUDIO_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const STUDIO_MAX_TRIANGLES = 1_250_000;
export const STUDIO_MAX_VERTICES = 2_500_000;
export const STUDIO_MAX_GPU_BYTES = 220 * 1024 * 1024;
export const STUDIO_MAX_FRAME_MS = 40;
export const STUDIO_SLOW_FRAME_STREAK = 14;

export const STUDIO_MESH_EXTENSIONS = [
  'stl',
  'obj',
  'gltf',
  'glb',
  'ply',
  '3mf',
  'fbx',
  'dae',
  '3ds',
  'usdz',
  'usd',
  'usda',
  'wrl',
  'vrml',
] as const;

export const STUDIO_CAD_EXPORT_HINT_EXTENSIONS = [
  'step',
  'stp',
  'iges',
  'igs',
] as const;

/** Native DCC files that are not mesh exports (same UX as STEP: hint, don't parse). */
export const STUDIO_DCC_EXPORT_HINT_EXTENSIONS = ['blend'] as const;

export type StudioMeshExtension = (typeof STUDIO_MESH_EXTENSIONS)[number];

export interface StudioTooMuchReport {
  reason: string;
  fileBytes?: number;
  triangles?: number;
  vertices?: number;
  gpuBytesEstimate?: number;
  frameMs?: number;
}

export interface StudioModelStats {
  name: string;
  format: string;
  fileBytes: number;
  triangles: number;
  vertices: number;
  gpuBytesEstimate: number;
  meshes: number;
}
