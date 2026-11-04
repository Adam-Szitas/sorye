/** One finished OCR analysis, without transcript or PDF bytes. */
export interface AnalyticsOcrJob {
  id: string;
  fileName: string;
  status: 'ready' | 'rows_only';
  pageCount: number;
  rowCount: number;
  createdAt: string;
  workStartedAt: string | null;
  workFinishedAt: string | null;
  /** Model time in milliseconds. Null when the GPU clock was not stored. */
  durationMs: number | null;
}

export interface OcrWorkSnapshot {
  count: number;
  timedCount: number;
  /** Sum of known model times. Null when none of the analyses recorded one. */
  totalDurationMs: number | null;
  jobs: AnalyticsOcrJob[];
}

export interface AnalyticsOcrSection {
  appId: 'ocr';
  appName: string;
  kind: 'ocr';
  count: number;
  timedCount: number;
  totalDurationMs: number | null;
  jobs: AnalyticsOcrJob[];
}

/** Apps that already emit workspace events. Counts only. */
export interface AnalyticsEventSection {
  appId: string;
  appName: string;
  kind: 'events';
  count: number;
}

export type AnalyticsAppSection = AnalyticsOcrSection | AnalyticsEventSection;

export interface WorkspaceAnalyticsSnapshot {
  sections: AnalyticsAppSection[];
}
