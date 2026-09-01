import { randomUUID } from 'crypto';
import type { AppHandoff, CreateHandoffInput } from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';

type HandoffStore = Record<string, AppHandoff[]>;

const handoffsFile = jsonDataFile<HandoffStore>('handoffs.json', () => ({}));

const readStore = () => handoffsFile.read();

export async function createHandoff(
  workspaceId: string,
  input: CreateHandoffInput,
): Promise<AppHandoff> {
  const handoff: AppHandoff = {
    id: `handoff-${randomUUID().slice(0, 12)}`,
    workspaceId,
    sourceAppId: input.sourceAppId,
    targetAppId: input.targetAppId,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    payload: input.payload,
    createdAt: new Date().toISOString(),
  };

  await handoffsFile.update((store) => {
    const list = store[workspaceId] ?? [];
    list.unshift(handoff);
    // Keep last 40 handoffs per workspace.
    store[workspaceId] = list.slice(0, 40);
  });
  return handoff;
}

export async function listHandoffs(
  workspaceId: string,
  opts?: { targetAppId?: string; unconsumedOnly?: boolean },
): Promise<AppHandoff[]> {
  const store = await readStore();
  let list = store[workspaceId] ?? [];
  if (opts?.targetAppId) {
    list = list.filter((h) => h.targetAppId === opts.targetAppId);
  }
  if (opts?.unconsumedOnly) {
    list = list.filter((h) => !h.consumedAt);
  }
  return list;
}

export async function getHandoff(
  workspaceId: string,
  handoffId: string,
): Promise<AppHandoff | null> {
  const store = await readStore();
  return (store[workspaceId] ?? []).find((h) => h.id === handoffId) ?? null;
}

export async function consumeHandoff(
  workspaceId: string,
  handoffId: string,
): Promise<AppHandoff | null> {
  return handoffsFile.update((store) => {
    const list = store[workspaceId] ?? [];
    const idx = list.findIndex((h) => h.id === handoffId);
    if (idx < 0) return null;
    const next = {
      ...list[idx]!,
      consumedAt: new Date().toISOString(),
    };
    list[idx] = next;
    store[workspaceId] = list;
    return next;
  });
}
