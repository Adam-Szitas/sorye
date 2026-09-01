import {
  STUDIO_MAX_FILE_BYTES,
  STUDIO_MAX_FRAME_MS,
  STUDIO_MAX_GPU_BYTES,
  STUDIO_MAX_TRIANGLES,
  STUDIO_MAX_VERTICES,
  STUDIO_SLOW_FRAME_STREAK,
  type StudioModelStats,
  type StudioTooMuchReport,
} from '@sorye/types';
import type { BufferGeometry, Mesh, Object3D } from 'three/webgpu';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function isMesh(obj: Object3D): obj is Mesh {
  return (obj as Mesh).isMesh === true;
}

function measureGeometry(geometry: BufferGeometry): {
  triangles: number;
  vertices: number;
  meshes: number;
  gpuBytesEstimate: number;
} {
  const pos = geometry.getAttribute('position');
  if (!pos) {
    return { triangles: 0, vertices: 0, meshes: 1, gpuBytesEstimate: 0 };
  }
  const vertices = pos.count;
  const idx = geometry.getIndex();
  const triangles = idx ? idx.count / 3 : vertices / 3;
  let gpuBytesEstimate = vertices * pos.itemSize * 4;
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (normal) gpuBytesEstimate += vertices * normal.itemSize * 4;
  if (uv) gpuBytesEstimate += vertices * uv.itemSize * 4;
  if (idx) gpuBytesEstimate += idx.count * 4;
  return { triangles, vertices, meshes: 1, gpuBytesEstimate };
}

export function measureObject(root: Object3D): {
  triangles: number;
  vertices: number;
  meshes: number;
  gpuBytesEstimate: number;
} {
  const bare = root.userData.studioGeometry as BufferGeometry | undefined;
  if (bare) return measureGeometry(bare);

  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  let gpuBytesEstimate = 0;

  root.traverse((child) => {
    if (!isMesh(child)) return;
    const piece = measureGeometry(child.geometry as BufferGeometry);
    meshes += 1;
    triangles += piece.triangles;
    vertices += piece.vertices;
    gpuBytesEstimate += piece.gpuBytesEstimate;
  });

  return { triangles, vertices, meshes, gpuBytesEstimate };
}

export function checkFileBudget(
  fileBytes: number,
): StudioTooMuchReport | null {
  if (fileBytes > STUDIO_MAX_FILE_BYTES) {
    return {
      reason: `File is ${formatBytes(fileBytes)}; limit is ${formatBytes(STUDIO_MAX_FILE_BYTES)}.`,
      fileBytes,
    };
  }
  return null;
}

export function checkMeshBudget(
  stats: Pick<StudioModelStats, 'triangles' | 'vertices' | 'gpuBytesEstimate'>,
): StudioTooMuchReport | null {
  if (stats.triangles > STUDIO_MAX_TRIANGLES) {
    return {
      reason: `${formatCount(stats.triangles)} triangles exceeds the ${formatCount(STUDIO_MAX_TRIANGLES)} cap.`,
      triangles: stats.triangles,
      vertices: stats.vertices,
      gpuBytesEstimate: stats.gpuBytesEstimate,
    };
  }
  if (stats.vertices > STUDIO_MAX_VERTICES) {
    return {
      reason: `${formatCount(stats.vertices)} vertices exceeds the ${formatCount(STUDIO_MAX_VERTICES)} cap.`,
      triangles: stats.triangles,
      vertices: stats.vertices,
      gpuBytesEstimate: stats.gpuBytesEstimate,
    };
  }
  if (stats.gpuBytesEstimate > STUDIO_MAX_GPU_BYTES) {
    return {
      reason: `Estimated GPU buffers ${formatBytes(stats.gpuBytesEstimate)} exceed ${formatBytes(STUDIO_MAX_GPU_BYTES)}.`,
      triangles: stats.triangles,
      vertices: stats.vertices,
      gpuBytesEstimate: stats.gpuBytesEstimate,
    };
  }
  return null;
}

export class FrameBudgetMonitor {
  private slowStreak = 0;
  private lastTs = 0;
  private warmup = 24;

  reset() {
    this.slowStreak = 0;
    this.lastTs = 0;
    this.warmup = 24;
  }

  /**
   * Returns a Too-much report if the GPU path is stalling the tab.
   */
  sample(now: number): StudioTooMuchReport | null {
    if (this.warmup > 0) {
      this.warmup -= 1;
      this.lastTs = now;
      return null;
    }
    if (this.lastTs === 0) {
      this.lastTs = now;
      return null;
    }
    const frameMs = now - this.lastTs;
    this.lastTs = now;
    if (frameMs > STUDIO_MAX_FRAME_MS) {
      this.slowStreak += 1;
    } else {
      this.slowStreak = Math.max(0, this.slowStreak - 1);
    }
    if (this.slowStreak >= STUDIO_SLOW_FRAME_STREAK) {
      return {
        reason: `WebGPU frames stayed above ${STUDIO_MAX_FRAME_MS}ms — Too-much shut the stage down.`,
        frameMs,
      };
    }
    return null;
  }
}
