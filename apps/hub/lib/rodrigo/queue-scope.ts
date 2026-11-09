import { createHash, timingSafeEqual } from 'node:crypto';
import type { RodrigoActionAppId } from '@sorye/types';

export function deriveActionQueueScope(appId: RodrigoActionAppId, userId: string, workspaceId: string): string {
  return createHash('sha256').update(`sorye-${appId}-queue-v1\0${userId}\0${workspaceId}`).digest('hex');
}

export function actionQueueScopeMatches(candidate: string | null, appId: RodrigoActionAppId, userId: string, workspaceId: string): boolean {
  if (!candidate || !/^[a-f0-9]{64}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(deriveActionQueueScope(appId, userId, workspaceId), 'hex'));
}
