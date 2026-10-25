/** Shared Tasks board models for Hub API + Tasks remote. */

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
