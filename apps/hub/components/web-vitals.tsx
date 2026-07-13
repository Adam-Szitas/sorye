'use client';

import { useReportWebVitals } from 'next/web-vitals';

type VitalMetric = {
  id: string;
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
};

function sendToAnalytics(metric: VitalMetric) {
  if (process.env.NODE_ENV === 'development') {
    const label = metric.rating === 'good' ? '✓' : '⚠';
    console.info(
      `[Web Vitals] ${label} ${metric.name}: ${Math.round(metric.value)} (${metric.rating})`,
    );
  }

  // Hook for production analytics (Datadog, Vercel Analytics, etc.)
  if (typeof window !== 'undefined' && 'performance' in window) {
    performance.mark(`vitals:${metric.name}:${Math.round(metric.value)}`);
  }
}

export function WebVitalsReporter() {
  useReportWebVitals(sendToAnalytics);
  return null;
}
