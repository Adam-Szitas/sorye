// One local Hub process owns the GPU workflow. Keep the lock across dev HMR.
// Multi-process deployments require a shared queue/lock as well as engine limits.
const key = Symbol.for('sorye.ocr.admission');
type State = { busy: boolean; availableAt: number };
const globals = globalThis as typeof globalThis & { [key]?: State };
const state = globals[key] ??= { busy: false, availableAt: 0 };

/** Reject overload before parsing a PDF; never accumulate an in-memory queue. */
export function acquireOcrSlot(): (() => void) | null {
  if (state.busy || Date.now() < state.availableAt) return null;
  state.busy = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.busy = false;
    // Short pause also gives the inference server time to observe cancellations.
    state.availableAt = Date.now() + 1_000;
  };
}
