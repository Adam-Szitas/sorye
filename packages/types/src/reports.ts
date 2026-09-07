import type { WorkspaceEventName } from './events';

export const REPORT_RANGE_DAYS = [7, 14, 30, 90] as const;
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number];

export const DEFAULT_REPORT_RANGE_DAYS: ReportRangeDays = 14;
export const MAX_REPORT_RANGE_DAYS = 90;

/** Ops funnel — only events that already exist on the allowlist. */
export const REPORT_FUNNEL_EVENTS: ReadonlyArray<{
  name: WorkspaceEventName;
  label: string;
}> = [
  { name: 'sorye.ocr.analyzed', label: 'OCR analyzed' },
  { name: 'sorye.ocr.ready', label: 'OCR ready' },
  { name: 'sorye.protocolio.generated', label: 'Protocolio generated' },
  { name: 'sorye.studio.loaded', label: 'Studio loaded' },
  { name: 'sorye.studio.too_much', label: 'Studio too-much' },
  { name: 'sorye.task.created', label: 'Tasks created' },
  { name: 'sorye.task.moved', label: 'Tasks moved' },
  { name: 'sorye.calendar.saved', label: 'Calendar saved' },
  { name: 'sorye.notes.saved', label: 'Notes saved' },
  { name: 'sorye.storefront.order_placed', label: 'Storefront orders' },
  { name: 'sorye.site.published', label: 'Site published' },
  { name: 'sorye.mail.sent', label: 'Mail sent' },
  { name: 'sorye.files.uploaded', label: 'Drive uploads' },
];

export const REPORT_EVENT_LABELS: Record<WorkspaceEventName, string> = {
  'sorye.system.events_activated': 'Events activated',
  'sorye.task.created': 'Task created',
  'sorye.task.updated': 'Task updated',
  'sorye.task.moved': 'Task moved',
  'sorye.calendar.saved': 'Calendar saved',
  'sorye.notes.saved': 'Notes saved',
  'sorye.ocr.analyzed': 'OCR analyzed',
  'sorye.ocr.ready': 'OCR ready',
  'sorye.protocolio.generated': 'Protocolio generated',
  'sorye.studio.loaded': 'Studio loaded',
  'sorye.studio.too_much': 'Studio too-much',
  'sorye.messenger.posted': 'Messenger posted',
  'sorye.storefront.order_placed': 'Storefront order placed',
  'sorye.site.published': 'Site published',
  'sorye.mail.sent': 'Mail sent',
  'sorye.files.uploaded': 'Drive uploaded',
  'sorye.test.ping': 'Test ping',
};

export interface ReportSeriesPoint {
  bucket: string;
  count: number;
}

export interface ReportNamedCount {
  id: string;
  label: string;
  count: number;
}

export interface WorkspaceReportsSnapshot {
  rangeDays: ReportRangeDays;
  granularity: 'day' | 'week';
  from: string;
  to: string;
  eventsEnabled: boolean;
  totals: {
    events: number;
    tooMuch: number;
    failedDeliveries: number;
  };
  series: ReportSeriesPoint[];
  byApp: ReportNamedCount[];
  byName: ReportNamedCount[];
  funnel: ReportNamedCount[];
}
