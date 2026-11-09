import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTurntable, setMaterialWireframe } from '../src/inspection-mode.ts';
import {
  alignedBufferSize,
  createIndexGpuBuffer,
  ensureIndexBuffer,
  indexTypedArray,
  installStudioIndexGuard,
  isIndexBufferTypeError,
  type StudioWebGpuBackend,
} from '../src/index-buffer-guard.ts';

const TYPE_ERROR =
  "Failed to execute 'setIndexBuffer' on 'GPURenderPassEncoder': parameter 1 is not of type 'GPUBuffer'.";

class FakeGPUBuffer {
  destroyed = false;
  size: number;
  mapped: Uint8Array;

  constructor(size: number, mapped: Uint8Array) {
    this.size = size;
    this.mapped = mapped;
  }

  getMappedRange(): ArrayBuffer {
    return this.mapped.buffer;
  }

  unmap(): void {}

  destroy(): void {
    this.destroyed = true;
  }
}

(globalThis as { GPUBuffer?: unknown }).GPUBuffer = FakeGPUBuffer;

function throwingPass() {
  const calls: unknown[] = [];
  return {
    calls,
    setIndexBuffer(buffer: unknown) {
      if (!(buffer instanceof FakeGPUBuffer)) {
        throw new TypeError(TYPE_ERROR);
      }
      calls.push(buffer);
    },
  };
}

function fakeDevice() {
  const created: FakeGPUBuffer[] = [];
  return {
    created,
    createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) {
      const buffer = new FakeGPUBuffer(descriptor.size, new Uint8Array(descriptor.size));
      created.push(buffer);
      return buffer;
    },
  };
}

function fakeBackend(device: ReturnType<typeof fakeDevice>, pass: ReturnType<typeof throwingPass>) {
  const slots = new WeakMap<object, { buffer?: unknown }>();
  const backend = {
    device,
    drew: 0,
    get(attribute: object) {
      let slot = slots.get(attribute);
      if (!slot) {
        slot = {};
        slots.set(attribute, slot);
      }
      return slot;
    },
    draw(this: { drew: number; get(attribute: object): { buffer?: unknown } }, renderObject: { getIndex?: () => { array?: unknown } | null }) {
      this.drew += 1;
      const index = renderObject.getIndex?.() ?? null;
      if (!index) return;
      pass.setIndexBuffer(this.get(index).buffer);
    },
  };
  return backend;
}

test('index byte length is padded to a 4-byte GPUBuffer size', () => {
  assert.equal(alignedBufferSize(0), 0);
  assert.equal(alignedBufferSize(2), 4);
  assert.equal(alignedBufferSize(4), 4);
  assert.equal(alignedBufferSize(6), 8);
});

test('plain CPU index arrays are copied into a typed array', () => {
  const plain = [0, 1, 2, 2, 3, 0];
  const typed = indexTypedArray(plain);
  assert.ok(typed instanceof Uint16Array);
  assert.notEqual(typed, plain);
  assert.deepEqual(Array.from(typed!), [0, 1, 2, 2, 3, 0]);
  assert.equal(indexTypedArray([]), null);
  assert.equal(indexTypedArray([1, Number.NaN]), null);

  const wide = indexTypedArray([0, 70_000, 1]);
  assert.ok(wide instanceof Uint32Array);
  assert.equal(wide![1], 70_000);
});

test('createIndexGpuBuffer returns a GPUBuffer, not the CPU array', () => {
  const device = fakeDevice();
  const cpu = new Uint16Array([4, 5, 6]);
  const buffer = createIndexGpuBuffer(device, cpu);
  assert.ok(buffer instanceof FakeGPUBuffer);
  assert.notEqual(buffer, cpu);
  assert.equal(buffer.size, 8);
  assert.deepEqual(Array.from(buffer.mapped.subarray(0, 6)), [4, 0, 5, 0, 6, 0]);
});

test('ensureIndexBuffer reuses a live buffer and skips when no index data exists', () => {
  const live = new FakeGPUBuffer(4, new Uint8Array(4));
  const slot = { buffer: live as unknown };
  const reused = ensureIndexBuffer(slot, new Uint16Array([1, 2, 3]), {
    isUsable: (buffer) => buffer instanceof FakeGPUBuffer && !(buffer as FakeGPUBuffer).destroyed,
    create: () => {
      throw new Error('should reuse');
    },
  });
  assert.equal(reused, true);
  assert.equal(slot.buffer, live);

  const empty = { buffer: [1, 2, 3] as unknown };
  const skipped = ensureIndexBuffer(empty, [], {
    isUsable: () => false,
    create: () => {
      throw new Error('should skip');
    },
  });
  assert.equal(skipped, false);
  assert.equal(empty.buffer, undefined);
});

test('draw guard does not pass a missing, CPU, destroyed, or foreign buffer to setIndexBuffer', () => {
  const device = fakeDevice();
  const pass = throwingPass();
  const backend = fakeBackend(device, pass);
  installStudioIndexGuard(backend as unknown as StudioWebGpuBackend);

  const wireIndex = { array: new Uint16Array([0, 1, 1, 2, 2, 0]) };
  assert.doesNotThrow(() => backend.draw({ getIndex: () => wireIndex }));
  assert.equal(pass.calls.length, 1);
  assert.ok(pass.calls[0] instanceof FakeGPUBuffer);
  assert.equal(backend.drew, 1);
  const created = pass.calls[0] as FakeGPUBuffer;
  assert.ok(created.size >= wireIndex.array.byteLength);

  pass.calls.length = 0;
  const before = device.created.length;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => wireIndex }));
  assert.equal(pass.calls[0], created);
  assert.equal(device.created.length, before);

  const cpu = new Uint16Array([3, 4, 5]);
  const cpuIndex = { array: cpu };
  backend.get(cpuIndex).buffer = cpu;
  pass.calls.length = 0;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => cpuIndex }));
  assert.ok(pass.calls[0] instanceof FakeGPUBuffer);
  assert.notEqual(pass.calls[0], cpu);

  const plain = [0, 1, 2];
  const plainIndex = { array: plain };
  backend.get(plainIndex).buffer = plain;
  pass.calls.length = 0;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => plainIndex }));
  assert.ok(pass.calls[0] instanceof FakeGPUBuffer);
  assert.ok(!Array.isArray(pass.calls[0]));

  const placeholderIndex = { array: new Uint16Array([8, 9, 10]) };
  backend.get(placeholderIndex).buffer = { buffer: [1, 2, 3] };
  pass.calls.length = 0;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => placeholderIndex }));
  assert.ok(pass.calls[0] instanceof FakeGPUBuffer);

  const dead = device.createBuffer({ size: 4, usage: 0 });
  dead.destroy();
  const deadIndex = { array: new Uint16Array([1, 1, 1]) };
  backend.get(deadIndex).buffer = dead;
  pass.calls.length = 0;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => deadIndex }));
  assert.notEqual(pass.calls[0], dead);
  assert.equal(dead.destroyed, true);

  const otherDevice = fakeDevice();
  const otherBackend = fakeBackend(otherDevice, throwingPass());
  installStudioIndexGuard(otherBackend as unknown as StudioWebGpuBackend);
  const foreign = otherDevice.createBuffer({ size: 4, usage: 0 });
  const foreignIndex = { array: new Uint16Array([2, 2, 2]) };
  backend.get(foreignIndex).buffer = foreign;
  pass.calls.length = 0;
  const foreignDestroyedBefore = foreign.destroyed;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => foreignIndex }));
  assert.notEqual(pass.calls[0], foreign);
  assert.equal(foreign.destroyed, foreignDestroyedBefore);

  const missing = { array: [] as number[] };
  const drewBefore = backend.drew;
  pass.calls.length = 0;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => missing }));
  assert.equal(pass.calls.length, 0);
  assert.equal(backend.drew, drewBefore);

  const drewLines = backend.drew;
  assert.doesNotThrow(() => backend.draw({ getIndex: () => null }));
  assert.equal(backend.drew, drewLines + 1);
});

test('a thrown setIndexBuffer TypeError is swallowed and the bad slot is cleared', () => {
  const device = fakeDevice();
  const pass = {
    setIndexBuffer() {
      throw new TypeError(TYPE_ERROR);
    },
  };
  const slots = new WeakMap<object, { buffer?: unknown }>();
  const backend = {
    device,
    get(attribute: object) {
      let slot = slots.get(attribute);
      if (!slot) {
        slot = {};
        slots.set(attribute, slot);
      }
      return slot;
    },
    draw(this: { get(attribute: object): { buffer?: unknown } }, renderObject: { getIndex?: () => { array?: unknown } | null }) {
      const index = renderObject.getIndex?.();
      if (!index) return;
      pass.setIndexBuffer();
      void this.get(index);
    },
  };
  installStudioIndexGuard(backend as unknown as StudioWebGpuBackend);
  const index = { array: new Uint16Array([1, 2, 3]) };
  assert.doesNotThrow(() => backend.draw({ getIndex: () => index }));
  assert.equal(backend.get(index).buffer, undefined);
  assert.equal(isIndexBufferTypeError(new TypeError(TYPE_ERROR)), true);
  assert.equal(isIndexBufferTypeError(new TypeError('other')), false);
});

test('wire and turntable update the inspection flags', () => {
  const ground = { wireframe: false, needsUpdate: false };
  const model = { wireframe: false, needsUpdate: false };
  const grid = { transparent: true, opacity: 0.35 };

  assert.equal(setMaterialWireframe(ground, true), true);
  assert.equal(ground.wireframe, true);
  assert.equal(ground.needsUpdate, true);
  assert.equal(setMaterialWireframe(model, true), true);
  assert.equal(setMaterialWireframe(grid, true), false);
  assert.equal('wireframe' in grid, false);
  assert.equal(setMaterialWireframe(ground, true), false);

  assert.equal(setMaterialWireframe(ground, false), true);
  assert.equal(ground.wireframe, false);

  const controls = { autoRotate: false };
  assert.equal(applyTurntable(null, true), true);
  assert.equal(applyTurntable(controls, true), true);
  assert.equal(controls.autoRotate, true);
  assert.equal(applyTurntable(controls, false), false);
  assert.equal(controls.autoRotate, false);
});
