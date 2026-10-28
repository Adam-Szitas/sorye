export interface VisibleRefresh {
  refresh(): Promise<void>;
  dispose(): void;
}

/** One bounded refresh at a time, with event bursts coalesced and hidden tabs idle. */
export function startVisibleRefresh(
  pull: (signal: AbortSignal) => Promise<void>,
  options: { intervalMs: number; events?: string[]; channels?: string[] },
): VisibleRefresh {
  if (typeof window === 'undefined') return { refresh: async () => {}, dispose() {} };
  let stopped = false;
  let running: Promise<void> | null = null;
  let active: AbortController | null = null;
  let safety: number | undefined;
  let queued: number | undefined;
  let dirty = false;
  let lastStarted = -Infinity;
  const available = () => !stopped && document.visibilityState !== 'hidden' && navigator.onLine !== false;
  const clearTimers = () => {
    window.clearTimeout(safety);
    window.clearTimeout(queued);
    safety = queued = undefined;
  };
  const request = () => {
    if (!available()) return;
    if (running) { dirty = true; return; }
    if (queued !== undefined) return;
    queued = window.setTimeout(() => {
      queued = undefined;
      void refresh();
    }, Math.max(75, 1000 - (Date.now() - lastStarted)));
  };
  const refresh = (): Promise<void> => {
    if (!available()) return Promise.resolve();
    if (running) return running;
    if (Date.now() - lastStarted < 1000) { request(); return Promise.resolve(); }
    clearTimers();
    lastStarted = Date.now();
    const controller = new AbortController();
    active = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    running = Promise.resolve().then(() => {
      if (!controller.signal.aborted) return pull(controller.signal);
    }).catch(() => {
      // A failed background read is retried at the next event or safety refresh.
    }).finally(() => {
      window.clearTimeout(timeout);
      active = null;
      running = null;
      if (available()) {
        safety = window.setTimeout(() => { safety = undefined; void refresh(); }, options.intervalMs);
        if (dirty) { dirty = false; request(); }
      }
    });
    return running;
  };
  const visibility = () => {
    if (available()) request();
    else { dirty = false; clearTimers(); active?.abort(); }
  };
  window.addEventListener('focus', request);
  window.addEventListener('online', request);
  window.addEventListener('offline', visibility);
  document.addEventListener('visibilitychange', visibility);
  for (const event of options.events ?? []) window.addEventListener(event, request);
  const channels: BroadcastChannel[] = [];
  for (const name of options.channels ?? []) {
    try {
      const channel = new BroadcastChannel(name);
      channel.onmessage = request;
      channels.push(channel);
    } catch { /* Optional browser API. */ }
  }
  void refresh();
  return {
    refresh,
    dispose() {
      stopped = true;
      clearTimers();
      active?.abort();
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      window.removeEventListener('offline', visibility);
      document.removeEventListener('visibilitychange', visibility);
      for (const event of options.events ?? []) window.removeEventListener(event, request);
      for (const channel of channels) channel.close();
    },
  };
}
