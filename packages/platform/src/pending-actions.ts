type AppFlusher = () => Promise<number>;

type FlusherRegistry = typeof globalThis & { __soryePendingActionFlushers?: Map<string, AppFlusher> };
const globalRegistry = globalThis as FlusherRegistry;
const flushers = globalRegistry.__soryePendingActionFlushers ??= new Map<string, AppFlusher>();

/** Register an app's best-effort queue flush for explicit logout and lifecycle triggers. */
export function registerPendingActionFlusher(appId: string, flush: AppFlusher): () => void {
  flushers.set(appId, flush);
  return () => { if (flushers.get(appId) === flush) flushers.delete(appId); };
}

/** Flush loaded apps with a bounded wait. IndexedDB remains the recovery source. */
export async function flushPendingActions(timeoutMs = 1500): Promise<{ remaining: number; failedApps: number }> {
  const results = await Promise.all([...flushers.values()].map(async (flush) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        flush(),
        new Promise<number>((resolve) => { timer = setTimeout(() => resolve(Number.POSITIVE_INFINITY), timeoutMs); }),
      ]);
    } catch { return Number.POSITIVE_INFINITY; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }));
  const remaining = results.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { remaining, failedApps: results.filter((value) => !Number.isFinite(value)).length };
}
