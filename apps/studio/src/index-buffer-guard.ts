/**
 * WebGPURenderer.draw passes backend.get(index).buffer straight to
 * GPURenderPassEncoder.setIndexBuffer. Wireframe mode swaps in a CPU index
 * that often has no GPU buffer yet (the node observer can skip the geometry
 * upload on the same frame). Undefined, a typed array, a plain array, a
 * destroyed buffer, or a buffer from a lost/other device all throw
 * "parameter 1 is not of type 'GPUBuffer'" and the frame never lands.
 */

const DESTROY_MARK = Symbol.for('sorye.studio.gpuBufferDestroyTrack');

const destroyedBuffers = new WeakSet<object>();
const bufferOwners = new WeakMap<object, object>();
const lostDevices = new WeakSet<object>();
const watchedDevices = new WeakSet<object>();

/** INDEX | COPY_DST | COPY_SRC. Matches the WebGPU spec when the enum is missing (unit tests). */
export function indexBufferUsageBits(): number {
  const usage = globalThis.GPUBufferUsage;
  if (usage) return usage.INDEX | usage.COPY_DST | usage.COPY_SRC;
  return 0x0010 | 0x0008 | 0x0004;
}

export function alignedBufferSize(byteLength: number): number {
  if (byteLength <= 0) return 0;
  const padded = byteLength + ((4 - (byteLength % 4)) % 4);
  return Math.max(4, padded);
}

export function isIndexBufferTypeError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes('setIndexBuffer') &&
    error.message.includes('GPUBuffer')
  );
}

export function indexTypedArray(array: unknown): Uint16Array | Uint32Array | null {
  if (array instanceof Uint32Array) return array.length > 0 ? array : null;
  if (array instanceof Uint16Array) return array.length > 0 ? array : null;
  if (!Array.isArray(array) || array.length === 0) return null;

  const copy = new Uint32Array(array.length);
  let max = 0;
  for (let i = 0; i < array.length; i += 1) {
    const value = array[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = value >>> 0;
    copy[i] = rounded;
    if (rounded > max) max = rounded;
  }
  if (max > 65535) return copy;
  const narrow = new Uint16Array(copy.length);
  narrow.set(copy);
  return narrow;
}

export function indexFormatFor(array: Uint16Array | Uint32Array): 'uint16' | 'uint32' {
  return array instanceof Uint16Array ? 'uint16' : 'uint32';
}

interface MappedIndexBuffer {
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

export interface IndexBufferDevice {
  createBuffer(descriptor: {
    label?: string;
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): MappedIndexBuffer;
  lost?: Promise<unknown>;
}

/**
 * Allocate a real index GPUBuffer and copy typed index data into it.
 * The typed array is never returned as the buffer.
 */
export function createIndexGpuBuffer<T extends MappedIndexBuffer>(
  device: { createBuffer(descriptor: {
    label?: string;
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): T },
  array: Uint16Array | Uint32Array,
): T {
  const size = alignedBufferSize(array.byteLength);
  if (size === 0) {
    throw new Error('Refusing to create an empty index buffer');
  }
  const buffer = device.createBuffer({
    label: 'studio-index',
    size,
    usage: indexBufferUsageBits(),
    mappedAtCreation: true,
  });
  new Uint8Array(buffer.getMappedRange()).set(
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
  );
  buffer.unmap();
  return buffer;
}

export interface IndexSlot {
  buffer?: unknown;
}

export interface EnsureIndexEnv {
  isUsable(buffer: unknown): boolean;
  release?(buffer: unknown): void;
  create(array: Uint16Array | Uint32Array): unknown;
}

/**
 * Reuse a live GPUBuffer or replace the slot with a newly created one.
 * Returns false when the indexed draw must be skipped. The slot is left
 * without a non-buffer placeholder in that case.
 */
export function ensureIndexBuffer(
  slot: IndexSlot,
  indexArray: unknown,
  env: EnsureIndexEnv,
): boolean {
  if (env.isUsable(slot.buffer)) return true;

  if (slot.buffer != null) {
    try {
      env.release?.(slot.buffer);
    } catch {
      // Destroying a lost or foreign buffer can throw.
    }
  }
  slot.buffer = undefined;

  const array = indexTypedArray(indexArray);
  if (!array) return false;

  let created: unknown;
  try {
    created = env.create(array);
  } catch {
    slot.buffer = undefined;
    return false;
  }
  if (!env.isUsable(created)) {
    slot.buffer = undefined;
    return false;
  }
  slot.buffer = created;
  return true;
}

interface IndexAttributeLike {
  array?: unknown;
  count?: number;
  itemSize?: number;
}

interface GuardedRenderObject {
  getIndex?: () => IndexAttributeLike | null;
}

export interface StudioWebGpuBackend {
  device: IndexBufferDevice & object;
  draw(renderObject: GuardedRenderObject, info: unknown): void;
  get(attribute: object): IndexSlot;
  createIndexAttribute?: (attribute: object) => void;
}

function trackDestroyedBuffers(): void {
  const GpuBuffer = globalThis.GPUBuffer;
  if (!GpuBuffer) return;
  const proto = GpuBuffer.prototype as GPUBuffer & { [DESTROY_MARK]?: boolean };
  if (proto[DESTROY_MARK]) return;
  const original = proto.destroy;
  proto.destroy = function destroy(this: GPUBuffer) {
    destroyedBuffers.add(this);
    return original.call(this);
  };
  proto[DESTROY_MARK] = true;
}

function watchDevice(device: IndexBufferDevice & object): void {
  if (watchedDevices.has(device)) return;
  watchedDevices.add(device);
  const original = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    const buffer = original(descriptor);
    if (buffer && typeof buffer === 'object') bufferOwners.set(buffer, device);
    return buffer;
  };
  device.lost?.then(
    () => {
      lostDevices.add(device);
    },
    () => {
      lostDevices.add(device);
    },
  );
}

function gpuBufferClass(): (new (...args: never[]) => GPUBuffer) | undefined {
  const candidate = globalThis.GPUBuffer;
  return typeof candidate === 'function' ? candidate : undefined;
}

function isGpuBuffer(buffer: unknown): buffer is GPUBuffer {
  const GpuBuffer = gpuBufferClass();
  return GpuBuffer !== undefined && buffer instanceof GpuBuffer;
}

function isUsableIndexBuffer(buffer: unknown, device: object): boolean {
  if (!isGpuBuffer(buffer)) return false;
  if (destroyedBuffers.has(buffer)) return false;
  if (lostDevices.has(device)) return false;
  const owner = bufferOwners.get(buffer);
  if (owner !== undefined && (owner !== device || lostDevices.has(owner))) return false;
  return true;
}

function adoptTypedIndex(index: IndexAttributeLike, array: Uint16Array | Uint32Array): void {
  if (index.array === array) return;
  index.array = array;
  if (typeof index.count === 'number') {
    const itemSize = typeof index.itemSize === 'number' && index.itemSize > 0 ? index.itemSize : 1;
    index.count = array.length / itemSize;
  }
}

/**
 * Install a draw wrapper so setIndexBuffer only ever receives a live GPUBuffer
 * for this device. Missing wireframe indexes are created; unusable ones are
 * dropped and that one indexed draw is skipped.
 */
export function installStudioIndexGuard(backend: StudioWebGpuBackend): () => void {
  trackDestroyedBuffers();
  const device = backend.device;
  watchDevice(device);

  const originalDraw = backend.draw;
  let active = true;

  backend.draw = function draw(this: StudioWebGpuBackend, renderObject, info) {
    if (!active) return originalDraw.call(this, renderObject, info);

    const index = renderObject?.getIndex?.() ?? null;
    if (index) {
      if (lostDevices.has(device)) return;
      const slot = this.get(index);
      const ready = ensureIndexBuffer(slot, index.array, {
        isUsable: (buffer) => isUsableIndexBuffer(buffer, device),
        release(buffer) {
          if (!isGpuBuffer(buffer) || destroyedBuffers.has(buffer)) return;
          const owner = bufferOwners.get(buffer);
          if (owner !== undefined && owner !== device) return;
          buffer.destroy();
        },
        create: (array) => {
          if (typeof this.createIndexAttribute === 'function') {
            try {
              adoptTypedIndex(index, array);
              this.createIndexAttribute(index);
            } catch {
              slot.buffer = undefined;
            }
            if (isUsableIndexBuffer(slot.buffer, device)) return slot.buffer;
            slot.buffer = undefined;
          }
          const latest = indexTypedArray(index.array) ?? array;
          adoptTypedIndex(index, latest);
          return createIndexGpuBuffer(device, latest);
        },
      });
      if (!ready) return;
    }

    try {
      return originalDraw.call(this, renderObject, info);
    } catch (error) {
      if (!isIndexBufferTypeError(error)) throw error;
      if (index) {
        const slot = this.get(index);
        if (isGpuBuffer(slot.buffer) && !destroyedBuffers.has(slot.buffer)) {
          try {
            slot.buffer.destroy();
          } catch {
            destroyedBuffers.add(slot.buffer);
          }
        } else if (slot.buffer && typeof slot.buffer === 'object') {
          destroyedBuffers.add(slot.buffer);
        }
        slot.buffer = undefined;
      }
    }
  };

  return () => {
    active = false;
    if (backend.draw !== originalDraw) {
      // Keep the wrapper only while this stage owns the backend.
      backend.draw = originalDraw;
    }
  };
}
