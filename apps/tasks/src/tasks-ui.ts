import { createAppStore, type AppStore } from '@sorye/platform';

export type TasksPanel = 'board' | 'settings';

export interface TasksUiState {
  panel: TasksPanel;
  searchQuery: string;
  newTaskTitle: string;
}

/** Private UI signals. The kernel does not read this store. */
export function createTasksUi(): AppStore<TasksUiState> {
  return createAppStore<TasksUiState>('tasks', {
    panel: 'board',
    searchQuery: '',
    newTaskTitle: '',
  });
}
