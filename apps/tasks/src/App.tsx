import { useCallback, useMemo, useState } from 'react';
import { StatusHandler, taskMatchesQuery } from './status-handler';
import { loadBoard, saveBoard } from './tasks-storage';
import { KanbanBoard } from './kanban-board';
import { StatusSettings } from './status-settings';
import { emitWorkspaceEvent } from './emit-event';
import type { TasksBoard } from './tasks-storage';
import './styles.css';

type Panel = 'board' | 'settings';

function emitTaskDiff(prev: TasksBoard, next: TasksBoard) {
  const prevById = new Map(prev.tasks.map((t) => [t.id, t]));
  for (const task of next.tasks) {
    const before = prevById.get(task.id);
    if (!before) {
      void emitWorkspaceEvent('sorye.task.created', {
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
      void emitWorkspaceEvent('sorye.task.moved', {
        title: `Task moved: ${task.title}`,
        summary: `${from ?? 'status'} → ${to ?? 'status'}`,
        appId: 'tasks',
        entityId: task.id,
      });
      continue;
    }
    if (before.title !== task.title || before.body !== task.body) {
      void emitWorkspaceEvent('sorye.task.updated', {
        title: `Task updated: ${task.title}`,
        appId: 'tasks',
        entityId: task.id,
      });
    }
  }
}

export default function App() {
  const [board, setBoard] = useState(loadBoard);
  const [panel, setPanel] = useState<Panel>('board');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handler = useMemo(() => new StatusHandler(board), [board]);

  const matchCount = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return board.tasks.filter((task) => taskMatchesQuery(task, q)).length;
  }, [board.tasks, searchQuery]);

  const apply = useCallback(
    (next: StatusHandler) => {
      const snapshot = next.getBoard();
      emitTaskDiff(board, snapshot);
      setBoard(snapshot);
      saveBoard(snapshot);
    },
    [board],
  );

  const addTask = () => {
    const next = handler.addTask(newTaskTitle);
    if (next.getBoard() !== board) {
      apply(next);
      setNewTaskTitle('');
    }
  };

  return (
    <div className="tasks-app">
      <header className="tasks-header">
        <div>
          <h1>Tasks</h1>
          <p>Kanban board with configurable workflow statuses</p>
        </div>
        <div className="tasks-header-actions">
          <span className="tasks-badge">Productivity</span>
          <div className="tasks-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'board' ? 'true' : 'false'}
              className={panel === 'board' ? 'active' : undefined}
              onClick={() => setPanel('board')}
            >
              Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'settings' ? 'true' : 'false'}
              className={panel === 'settings' ? 'active' : undefined}
              onClick={() => setPanel('settings')}
            >
              Statuses
            </button>
          </div>
        </div>
      </header>

      {panel === 'board' ? (
        <>
          <div className="tasks-toolbar">
            <label className="field field-search field-grow">
              Search tasks
              <div className="search-input-wrap">
                <input
                  type="search"
                  placeholder="Search by title or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="btn-icon search-clear"
                    aria-label="Clear search"
                    onClick={() => setSearchQuery('')}
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
                onChange={(e) => setNewTaskTitle(e.target.value)}
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
      ) : (
        <StatusSettings handler={handler} onChange={apply} />
      )}
    </div>
  );
}
