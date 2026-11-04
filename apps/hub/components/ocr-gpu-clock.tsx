'use client';

import { formatOcrGpuDuration } from '@sorye/types';
import { useEffect, useState } from 'react';

/** Model-time label for a stored reading. Ticks only while the model call is still open. */
export function OcrGpuClock({
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
  return <span className="reading-gpu">{label}</span>;
}
