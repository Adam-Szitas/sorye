import {
  APP_CATALOG,
  type AnalyticsAppSection,
  type WorkspaceAnalyticsSnapshot,
} from '@sorye/types';
import { listWorkspaceAppEventCounts } from '@/lib/reports';
import { listOcrWork } from '@/lib/store/ocr-analyses';

/** Per-app work for the signed-in workspace. Empty apps are left out. */
export async function getWorkspaceAnalytics(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAnalyticsSnapshot | null> {
  const [work, events] = await Promise.all([
    listOcrWork(userId, workspaceId),
    listWorkspaceAppEventCounts(workspaceId),
  ]);
  if (work.access === 'denied') return null;

  const eventsByApp = new Map(events.map((item) => [item.id, item]));
  const sections: AnalyticsAppSection[] = [];
  for (const app of APP_CATALOG) {
    if (app.id === 'ocr' && work.work.count > 0) {
      sections.push({
        appId: 'ocr',
        appName: app.name,
        kind: 'ocr',
        count: work.work.count,
        timedCount: work.work.timedCount,
        totalDurationMs: work.work.totalDurationMs,
        jobs: work.work.jobs,
      });
      continue;
    }
    const event = eventsByApp.get(app.id);
    if (!event || event.count <= 0) continue;
    sections.push({
      appId: app.id,
      appName: app.name,
      kind: 'events',
      count: event.count,
    });
  }

  const ocrIndex = sections.findIndex((section) => section.appId === 'ocr');
  if (ocrIndex > 0) {
    const [ocr] = sections.splice(ocrIndex, 1);
    if (ocr) sections.unshift(ocr);
  }
  return { sections };
}
