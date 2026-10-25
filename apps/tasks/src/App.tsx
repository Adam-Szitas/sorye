import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKernel, useSignalValue } from '@sorye/platform/react';
import { StatusHandler, taskMatchesQuery } from './status-handler';
import { createDefaultBoard, loadBoard, saveBoard } from './tasks-storage';
import { KanbanBoard } from './kanban-board';
import { StatusSettings } from './status-settings';
import { emitTaskEvent } from './emit-event';
import { createTasksUi } from './tasks-ui';
import type { TasksBoard } from './tasks-storage';
import type { KernelClient } from '@sorye/platform';
import './styles.css';

function emitTaskDiff(kernel: KernelClient, prev: TasksBoard, next: TasksBoard) {
  const prevById = new Map(prev.tasks.map((t) => [t.id, t]));
  for (const task of next.tasks) {
    const before = prevById.get(task.id);
    if (!before) {
      void emitTaskEvent(kernel, 'sorye.task.created', {
        title: `Task created: ${task.title}`,
        summary: `Added to board`,
        appId: 'tasks',
        entityId: task.id,
      });
      continue;
    }
    if (before.statusId !== task.statusId) {
      const from = prev.statuses.find((s) => s.id === before.statusId)?.name;
      const to = next.statuses.find((s) => s.id === task.statusId)?.name;
      void emitTaskEvent(kernel, 'sorye.task.moved', {
        title: `Task moved: ${task.title}`,
        summary: `${from ?? 'status'} → ${to ?? 'status'}`,
        appId: 'tasks',
        entityId: task.id,
      });
      continue;
    }
    if (before.title !== task.title || before.body !== task.body) {
      void emitTaskEvent(kernel, 'sorye.task.updated', {
        title: `Task updated: ${task.title}`,
        appId: 'tasks',
        entityId: task.id,
      });
    }
  }
}

export default function App() {
  const kernel = useKernel();
  const workspaceName = useSignalValue(kernel.signals.workspaceName);
  const userDisplayName = useSignalValue(kernel.signals.userDisplayName);
  const uiRef = useRef<ReturnType<typeof createTasksUi> | null>(null);
  if (!uiRef.current) uiRef.current = createTasksUi();
  const ui = uiRef.current;
  const panel = useSignalValue(ui.state.panel);
  const searchQuery = useSignalValue(ui.state.searchQuery);
  const newTaskTitle = useSignalValue(ui.state.newTaskTitle);
  const contextLabel = [workspaceName, userDisplayName]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  const [board, setBoard] = useState<TasksBoard>(createDefaultBoard);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadBoard()
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handler = useMemo(() => new StatusHandler(board), [board]);

  const matchCount = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return board.tasks.filter((task) => taskMatchesQuery(task, q)).length;
  }, [board.tasks, searchQuery]);

  const apply = useCallback(
    (next: StatusHandler) => {
      const snapshot = next.getBoard();
      emitTaskDiff(kernel, board, snapshot);
      setBoard(snapshot);
      void saveBoard(snapshot).then(
        () => setSaveError(null),
        () => setSaveError('Could not save tasks to the workspace.'),
      );
    },
    [board, kernel],
  );

  const addTask = () => {
    const next = handler.addTask(newTaskTitle);
    if (next.getBoard() !== board) {
      apply(next);
      ui.state.newTaskTitle.value = '';
    }
  };

  return (
    <div className="tasks-app">
      <header className="tasks-header">
        <div>
          <h1>Tasks</h1>
          <p>
            {contextLabel
              ? `${contextLabel} · Kanban board with configurable workflow statuses`
              : 'Kanban board with configurable workflow statuses'}
          </p>
        </div>
        <div className="tasks-header-actions">
          <span className="tasks-badge">Productivity</span>
          <div className="tasks-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'board' ? 'true' : 'false'}
              className={panel === 'board' ? 'active' : undefined}
              onClick={() => {
                ui.state.panel.value = 'board';
              }}
            >
              Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'settings' ? 'true' : 'false'}
              className={panel === 'settings' ? 'active' : undefined}
              onClick={() => {
                ui.state.panel.value = 'settings';
              }}
            >
              Statuses
            </button>
          </div>
        </div>
      </header>

      {loadState === 'loading' ? (
        <p className="search-results-meta">Loading workspace tasks…</p>
      ) : null}
      {loadState === 'error' ? (
        <p className="search-results-meta" role="alert">
          Could not load tasks from the workspace.
        </p>
      ) : null}
      {saveError ? (
        <p className="search-results-meta" role="alert">
          {saveError}
        </p>
      ) : null}

      {loadState === 'ready' && panel === 'board' ? (
        <>
          <div className="tasks-toolbar">
            <label className="field field-search field-grow">
              Search tasks
              <div className="search-input-wrap">
                <input
                  type="search"
                  placeholder="Search by title or notes..."
                  value={searchQuery}
                  onChange={(e) => {
                    ui.state.searchQuery.value = e.target.value;
                  }}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="btn-icon search-clear"
                    aria-label="Clear search"
                    onClick={() => {
                      ui.state.searchQuery.value = '';
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </label>
            {matchCount !== null ? (
              <p className="search-results-meta" aria-live="polite">
                {matchCount === 0
                  ? 'No tasks match'
                  : `${matchCount} task${matchCount === 1 ? '' : 's'} match`}
              </p>
            ) : null}
          </div>

          <div className="tasks-toolbar">
            <label className="field field-grow">
              New task
              <input
                type="text"
                placeholder="What needs to be done?"
                value={newTaskTitle}
                onChange={(e) => {
                  ui.state.newTaskTitle.value = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTask();
                }}
              />
            </label>
            <button type="button" className="btn-primary" onClick={addTask}>
              Add task
            </button>
          </div>

          <KanbanBoard
            handler={handler}
            searchQuery={searchQuery}
            onChange={apply}
          />
        </>
      ) : null}

      {loadState === 'ready' && panel === 'settings' ? (
        <StatusSettings handler={handler} onChange={apply} />
      ) : null}
    </div>
  );
}
