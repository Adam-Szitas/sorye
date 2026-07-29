import {
  createDefaultBoard,
  type TasksBoard,
} from './status-handler';

export type { TasksBoard };

const STORAGE_KEY = 'sorye:tasks:board';

function isTaskStatus(value: unknown): value is TasksBoard['statuses'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.color === 'string' &&
    typeof record.order === 'number'
  );
}

function isTaskItem(value: unknown): value is TasksBoard['tasks'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    typeof record.statusId === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

function normalizeBoard(raw: unknown): TasksBoard | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.statuses) || !Array.isArray(record.tasks)) {
    return null;
  }

  const statuses = record.statuses.filter(isTaskStatus);
  const tasks = record.tasks.filter(isTaskItem);
  if (statuses.length === 0) return null;

  const statusIds = new Set(statuses.map((s) => s.id));
  const fallbackStatusId = statuses[0].id;

  return {
    statuses,
    tasks: tasks.map((task) =>
      statusIds.has(task.statusId)
        ? task
        : { ...task, statusId: fallbackStatusId },
    ),
  };
}

export function loadBoard(): TasksBoard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultBoard();
    const parsed = JSON.parse(raw) as unknown;
    return normalizeBoard(parsed) ?? createDefaultBoard();
  } catch {
    return createDefaultBoard();
  }
}

export function saveBoard(board: TasksBoard) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}
