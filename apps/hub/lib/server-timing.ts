/** Development-only timings visible in DevTools; contains durations, never user data. */
export class ServerTimings {
  private durations = new Map<string, number>();

  async measure<T>(name: string, task: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await task(); }
    finally { this.durations.set(name, (this.durations.get(name) ?? 0) + performance.now() - start); }
  }

  headers(): Record<string, string> {
    if (process.env.NODE_ENV !== 'development') return {};
    return { 'Server-Timing': [...this.durations].map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', ') };
  }
}
