import { formatOcrGpuDuration } from '@sorye/types';
import { useEffect, useState } from 'react';

/** Live model-time label. `finishedAt` freezes the clock; otherwise it ticks once a second. */
export function GpuClock({
  startedAt,
  finishedAt,
  live = false,
}: {
  startedAt?: string | null;
  finishedAt?: string | null;
  live?: boolean;
}) {
  const ticking = live && Boolean(startedAt) && !finishedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  if (!startedAt || (!finishedAt && !ticking)) return null;
  const label = formatOcrGpuDuration(startedAt, finishedAt, now);
  if (!label) return null;
  return <span className="ocr-gpu-time">{label}</span>;
}
