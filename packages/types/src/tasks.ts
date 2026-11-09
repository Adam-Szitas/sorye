/** Shared Tasks board models for Hub API + Tasks remote. */

export interface TaskStatus {
  id: string;
  name: string;
  color: string;
  order: number;
}

/** Hub Drive object id. Not a path, workspace, or Rodrigo blob. */
const TASK_DRIVE_FILE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isTaskDriveFileId(value: unknown): value is string {
  return typeof value === 'string' && TASK_DRIVE_FILE_ID_RE.test(value);
}

/** Images on one ticket. Each id is a Hub Drive object; the bytes stay in Drive. */
export const TASK_ATTACHMENT_MAX = 8;

export function isTaskAttachmentList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > TASK_ATTACHMENT_MAX) return false;
  const seen = new Set<string>();
  for (const id of value) {
    if (!isTaskDriveFileId(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export interface TaskItem {
  id: string;
  title: string;
  body: string;
  statusId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Images in the Drive Tasks section (`sourceAppId: "tasks"`).
   * Rodrigo stores these ids only. Omit when the ticket has no images.
   */
  attachmentIds?: string[];
  /**
   * Legacy single photo id. Read once and rewritten as `attachmentIds`.
   * A task must not store both fields.
   */
  driveFileId?: string;
}

/** Ids to show. An explicit list, including an empty one, wins over the legacy photo. */
export function taskImageIds(task: { attachmentIds?: readonly string[]; driveFileId?: string }): string[] {
  if (Array.isArray(task.attachmentIds)) return [...task.attachmentIds];
  return isTaskDriveFileId(task.driveFileId) ? [task.driveFileId] : [];
}

/** Board write shape: image ids live on `attachmentIds` only. */
export function taskForStorage(task: TaskItem): TaskItem {
  const images = taskImageIds(task);
  const next: TaskItem = { ...task };
  delete next.driveFileId;
  if (images.length > 0) next.attachmentIds = [...images];
  else delete next.attachmentIds;
  return next;
}

/**
 * Ticket id from a pasted id or from a board URL.
 * Only the `ticket` query value is read. Other query keys are ignored.
 */
export function ticketIdFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      return new URL(trimmed).searchParams.get('ticket')?.trim() ?? '';
    } catch {
      return '';
    }
  }
  const embedded = /(?:^|[?&])ticket=([^&#\s]*)/.exec(trimmed);
  if (embedded) {
    try {
      return decodeURIComponent(embedded[1].replace(/\+/g, ' ')).trim();
    } catch {
      return '';
    }
  }
  return trimmed;
}

/** Exact id match. Duplicate ids fail closed instead of opening the first copy. */
export function findTaskByTicketId<T extends { id: string }>(tasks: readonly T[], raw: string): T | undefined {
  const id = ticketIdFromInput(raw);
  if (!id) return undefined;
  const matches = tasks.filter((task) => task.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface TasksBoard {
  statuses: TaskStatus[];
  tasks: TaskItem[];
}

/** Browser key used only for one-time migrate off localStorage. */
export const TASKS_LOCAL_STORAGE_KEY = 'sorye:tasks:board';

export function createDefaultTasksBoard(): TasksBoard {
  const statuses: TaskStatus[] = [
    { id: 'status-backlog', name: 'Backlog', color: '#64748b', order: 0 },
    { id: 'status-todo', name: 'To do', color: '#38bdf8', order: 1 },
    {
      id: 'status-progress',
      name: 'In progress',
      color: '#fbbf24',
      order: 2,
    },
    { id: 'status-review', name: 'Review', color: '#a78bfa', order: 3 },
    { id: 'status-done', name: 'Done', color: '#34d399', order: 4 },
  ];

  const now = new Date().toISOString();
  return {
    statuses,
    tasks: [
      {
        id: 'task-seed-1',
        title: 'Set up your first board',
        body: 'Drag cards between columns or use the status menu on each card.',
        statusId: 'status-todo',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'task-seed-2',
        title: 'Customize workflow statuses',
        body: 'Open Board settings to add, rename, reorder, or remove columns.',
        statusId: 'status-backlog',
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}
