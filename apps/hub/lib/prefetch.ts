const prefetched = new Set<string>();

export function prefetchMicroFrontend(remoteEntry: string) {
  if (typeof document === 'undefined' || prefetched.has(remoteEntry)) return;
  prefetched.add(remoteEntry);

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'script';
  link.href = remoteEntry;
  document.head.appendChild(link);
}

export function preloadPanelChunk(panel: 'picker' | 'connections') {
  if (panel === 'picker') {
    void import('@/components/app-picker');
    return;
  }
  void import('@/components/connections-panel');
}
