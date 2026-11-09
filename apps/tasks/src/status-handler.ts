import {
  createDefaultTasksBoard,
  taskForStorage,
  taskImageIds,
  type TaskItem,
  type TaskStatus,
  type TasksBoard,
} from '@sorye/types';

export type { TaskItem, TaskStatus, TasksBoard };

export type StatusPatch = Partial<Pick<TaskStatus, 'name' | 'color'>>;
export type TaskPatch = Partial<Pick<TaskItem, 'title' | 'body' | 'statusId' | 'attachmentIds'>>;

/** Stable board id. Retries when the short id is already on this workspace board. */
export function allocateTaskId(existing: ReadonlySet<string>, next: () => string = () => crypto.randomUUID()): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `task-${next().slice(0, 8)}`;
    if (!existing.has(id)) return id;
  }
  const id = `task-${next()}`;
  if (existing.has(id)) throw new Error('Could not allocate a unique task id');
  return id;
}

const STATUS_COLORS = [
  '#64748b',
  '#38bdf8',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fb7185',
  '#818cf8',
];

function sortStatuses(statuses: TaskStatus[]): TaskStatus[] {
  return [...statuses].sort((a, b) => a.order - b.order);
}

function nextOrder(statuses: TaskStatus[]): number {
  if (statuses.length === 0) return 0;
  return Math.max(...statuses.map((s) => s.order)) + 1;
}

function pickColor(statuses: TaskStatus[]): string {
  const used = new Set(statuses.map((s) => s.color));
  return STATUS_COLORS.find((c) => !used.has(c)) ?? STATUS_COLORS[0];
}

function touchTask(task: TaskItem): TaskItem {
  return { ...task, updatedAt: new Date().toISOString() };
}

function applyTaskPatch(task: TaskItem, patch: TaskPatch, statusId: string): TaskItem {
  const images = 'attachmentIds' in patch ? (patch.attachmentIds ?? []) : taskImageIds(task);
  const next: TaskItem = touchTask({ ...task, ...patch, statusId });
  delete next.driveFileId;
  if (images.length > 0) next.attachmentIds = [...images];
  else delete next.attachmentIds;
  return next;
}

/**
 * Configurable status handler for the Tasks board.
 * Each method returns a new board snapshot (immutable updates).
 */
export function taskMatchesQuery(task: TaskItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    task.title.toLowerCase().includes(trimmed) ||
    task.body.toLowerCase().includes(trimmed)
  );
}

export class StatusHandler {
  constructor(private readonly board: TasksBoard) {}

  getBoard(): TasksBoard {
    return this.board;
  }

  getStatuses(): TaskStatus[] {
    return sortStatuses(this.board.statuses);
  }

  getStatus(statusId: string): TaskStatus | undefined {
    return this.board.statuses.find((s) => s.id === statusId);
  }

  getTasksForStatus(statusId: string): TaskItem[] {
    return this.board.tasks
      .filter((task) => task.statusId === statusId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  moveTaskToStatus(taskId: string, statusId: string): StatusHandler {
    if (!this.getStatus(statusId)) return this;
    return new StatusHandler({
      ...this.board,
      tasks: this.board.tasks.map((task) =>
        task.id === taskId
          ? taskForStorage(touchTask({ ...task, statusId }))
          : task,
      ),
    });
  }

  addTask(title: string, statusId?: string): StatusHandler {
    const trimmed = title.trim();
    if (!trimmed) return this;

    const statuses = this.getStatuses();
    const targetStatus = statusId
      ? this.getStatus(statusId)
      : statuses[0];
    if (!targetStatus) return this;

    const now = new Date().toISOString();
    const task: TaskItem = {
      id: allocateTaskId(new Set(this.board.tasks.map((item) => item.id))),
      title: trimmed,
      body: '',
      statusId: targetStatus.id,
      createdAt: now,
      updatedAt: now,
    };

    return new StatusHandler({
      ...this.board,
      tasks: [task, ...this.board.tasks],
    });
  }

  updateTask(taskId: string, patch: TaskPatch): StatusHandler {
    return new StatusHandler({
      ...this.board,
      tasks: this.board.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const statusId = patch.statusId && this.getStatus(patch.statusId) ? patch.statusId : task.statusId;
        return applyTaskPatch(task, patch, statusId);
      }),
    });
  }

  removeTask(taskId: string): StatusHandler {
    return new StatusHandler({
      ...this.board,
      tasks: this.board.tasks.filter((task) => task.id !== taskId),
    });
  }

  addStatus(name: string, color?: string): StatusHandler {
    const trimmed = name.trim();
    if (!trimmed) return this;

    const status: TaskStatus = {
      id: `status-${crypto.randomUUID().slice(0, 8)}`,
      name: trimmed,
      color: color ?? pickColor(this.board.statuses),
      order: nextOrder(this.board.statuses),
    };

    return new StatusHandler({
      ...this.board,
      statuses: [...this.board.statuses, status],
    });
  }

  updateStatus(statusId: string, patch: StatusPatch): StatusHandler {
    return new StatusHandler({
      ...this.board,
      statuses: this.board.statuses.map((status) =>
        status.id === statusId ? { ...status, ...patch } : status,
      ),
    });
  }

  removeStatus(statusId: string): StatusHandler {
    const statuses = this.getStatuses();
    if (statuses.length <= 1) return this;

    const index = statuses.findIndex((s) => s.id === statusId);
    if (index === -1) return this;

    const fallback =
      statuses[index + 1]?.id ?? statuses[index - 1]?.id ?? statuses[0].id;

    return new StatusHandler({
      statuses: this.board.statuses.filter((s) => s.id !== statusId),
      tasks: this.board.tasks.map((task) =>
        task.statusId === statusId
          ? touchTask({ ...task, statusId: fallback })
          : task,
      ),
    });
  }

  moveStatus(statusId: string, direction: -1 | 1): StatusHandler {
    const ordered = this.getStatuses();
    const index = ordered.findIndex((s) => s.id === statusId);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) {
      return this;
    }

    const current = ordered[index];
    const swap = ordered[swapIndex];
    const statuses = this.board.statuses.map((status) => {
      if (status.id === current.id) return { ...status, order: swap.order };
      if (status.id === swap.id) return { ...status, order: current.order };
      return status;
    });

    return new StatusHandler({ ...this.board, statuses });
  }
}

export function createDefaultBoard(): TasksBoard {
  return createDefaultTasksBoard();
}
