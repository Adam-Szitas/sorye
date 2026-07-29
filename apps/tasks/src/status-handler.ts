export interface TaskStatus {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface TaskItem {
  id: string;
  title: string;
  body: string;
  statusId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TasksBoard {
  statuses: TaskStatus[];
  tasks: TaskItem[];
}

export type StatusPatch = Partial<Pick<TaskStatus, 'name' | 'color'>>;
export type TaskPatch = Partial<Pick<TaskItem, 'title' | 'body'>>;

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
          ? touchTask({ ...task, statusId })
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
      id: `task-${crypto.randomUUID().slice(0, 8)}`,
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
      tasks: this.board.tasks.map((task) =>
        task.id === taskId ? touchTask({ ...task, ...patch }) : task,
      ),
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
