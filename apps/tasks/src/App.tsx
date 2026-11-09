import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { registerPendingActionFlusher, switchAuthorizedWorkspace } from '@sorye/platform';
import { useKernel, useSignalValue, UserLoadSections } from '@sorye/platform/react';
import type { TaskItem, UserLoadPartition, UserLoadWorkspace } from '@sorye/types';
import { StatusHandler, taskMatchesQuery } from './status-handler';
import { createDefaultBoard, createTasksStorage } from './tasks-storage';
import { KanbanBoard } from './kanban-board';
import { TaskEditor } from './task-editor';
import type { TaskPatch } from './status-handler';
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
    if (before.title !== task.title || before.body !== task.body || before.driveFileId !== task.driveFileId) {
      void emitTaskEvent(kernel, 'sorye.task.updated', {
        title: `Task updated: ${task.title}`,
        appId: 'tasks',
        entityId: task.id,
      });
    }
  }
}

export default function App() {
  const storage = useMemo(() => createTasksStorage(), []);
  const { loadBoard, saveBoard } = storage;
  const kernel = useKernel();
  const uiRef = useRef<ReturnType<typeof createTasksUi> | null>(null);
  if (!uiRef.current) uiRef.current = createTasksUi();
  const ui = uiRef.current;
  const panel = useSignalValue(ui.state.panel);
  const searchQuery = useSignalValue(ui.state.searchQuery);
  const newTaskTitle = useSignalValue(ui.state.newTaskTitle);
  const [board, setBoard] = useState<TasksBoard>(createDefaultBoard);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [queueState, setQueueState] = useState({ pending: 0, failed: 0, conflicts: 0, rejected: 0 });
  const [conflictDraftAvailable, setConflictDraftAvailable] = useState(false);
  const [taskLoad, setTaskLoad] = useState<UserLoadPartition<TaskItem> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskWorkspace, setTaskWorkspace] = useState<UserLoadWorkspace | null>(null);

  const refreshQueueState = useCallback(async () => {
    try {
      const state = await storage.queueState();
      setQueueState(state);
      if (state.conflicts > 0) {
        setSaveError('The task board changed elsewhere. Download your queued draft or discard it and reload the latest board.');
        setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
      } else if (state.rejected > 0) setSaveError('Rodrigo rejected a queued task action. Review the error before continuing.');
    } catch { /* the queue error is shown with the save state */ }
  }, [storage]);

  useEffect(() => {
    let cancelled = false;
    const bestEffortFlush = async () => {
      await storage.resendPending().catch(() => undefined);
      const state = await storage.queueState().catch(() => ({ pending: 1, failed: 0, conflicts: 0, rejected: 0 }));
      return state.pending + state.failed + state.conflicts + state.rejected;
    };
    const unregister = registerPendingActionFlusher('tasks', bestEffortFlush);
    window.addEventListener('pagehide', bestEffortFlush);
    window.addEventListener('sorye:logout-flush', bestEffortFlush);
    void loadBoard()
      .then(async (next) => {
        if (cancelled) return;
        setBoard(next);
        const listed = storage.readTaskLoad();
        setTaskLoad(listed.load);
        setTaskWorkspace(listed.workspace);
        setLoadState('ready');
        await refreshQueueState();
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', bestEffortFlush);
      window.removeEventListener('sorye:logout-flush', bestEffortFlush);
      unregister();
    };
  }, [loadBoard, refreshQueueState, storage]);

  const handler = useMemo(() => new StatusHandler(board), [board]);

  const matchCount = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return board.tasks.filter((task) => taskMatchesQuery(task, q)).length;
  }, [board.tasks, searchQuery]);

  const apply = useCallback(
    (next: StatusHandler) => {
      const snapshot = next.getBoard();
      setBoard(snapshot);
      void saveBoard(snapshot).then(
        () => { emitTaskDiff(kernel, board, snapshot); setSaveError(null); setConflictDraftAvailable(false); void refreshQueueState(); },
        (err: unknown) => {
          setSaveError(err instanceof Error ? err.message : 'Could not save to the workspace.');
          if (storage.isConflict(err)) setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
          void refreshQueueState();
        },
      );
    },
    [board, kernel, storage, refreshQueueState],
  );

  const resendPending = async () => {
    await storage.resendPending();
    await refreshQueueState();
    if (queueState.pending + queueState.failed > 0) setSaveError('Some task actions still need confirmation. Review conflicts or retry again.');
    else setSaveError(null);
  };

  const downloadConflictDraft = () => {
    const draft = storage.readConflictDraft();
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sorye-tasks-conflict-draft.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const discardDraftAndReload = async () => {
    try {
      await storage.discardConflictsAndRejected();
      const latest = await loadBoard();
      storage.clearConflictDraft();
      setBoard(latest);
      const listed = storage.readTaskLoad();
      setTaskLoad(listed.load);
      setTaskWorkspace(listed.workspace);
      setConflictDraftAvailable(false);
      setSaveError(null);
      await refreshQueueState();
    } catch {
      setSaveError('Could not reload the latest tasks. Your draft is still available in this browser.');
    }
  };

  const openTaskWorkspace = async (workspaceId: string) => {
    if (workspaceId === taskWorkspace?.id) return;
    const switched = await switchAuthorizedWorkspace(workspaceId);
    if (!switched) return;
    const latest = await loadBoard();
    const listed = storage.readTaskLoad();
    setBoard(latest);
    setTaskLoad(listed.load);
    setTaskWorkspace(listed.workspace);
  };

  const otherTasks = taskLoad && taskWorkspace
    ? {
        personal: taskWorkspace.kind === 'personal' ? [] : taskLoad.personal,
        work: taskLoad.work.filter((group) => group.workspace.id !== taskWorkspace.id),
      }
    : null;

  const persistTask = useCallback(async (taskId: string, patch: TaskPatch) => {
    const next = handler.updateTask(taskId, patch);
    const snapshot = next.getBoard();
    setBoard(snapshot);
    try {
      await saveBoard(snapshot);
      emitTaskDiff(kernel, board, snapshot);
      setSaveError(null);
      setConflictDraftAvailable(false);
      await refreshQueueState();
    } catch (err) {
      setBoard(board);
      setSaveError(err instanceof Error ? err.message : 'Could not save to the workspace.');
      if (storage.isConflict(err)) setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
      await refreshQueueState();
      throw err;
    }
  }, [board, handler, kernel, refreshQueueState, saveBoard, storage]);

  const editingTask = board.tasks.find((task) => task.id === editingId) ?? null;

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
        <div className="tasks-header-actions">
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
        <div className="search-results-meta" role="alert">
          {saveError}
          {conflictDraftAvailable ? <div className="tasks-toolbar">
            <button type="button" className="btn-ghost" onClick={downloadConflictDraft}>Download my draft</button>
            <button type="button" className="btn-ghost" onClick={() => void discardDraftAndReload()}>Discard draft and load latest</button>
          </div> : null}
        </div>
      ) : null}
      {(queueState.pending + queueState.failed + queueState.conflicts + queueState.rejected) > 0 ? (
        <div className="search-results-meta" role="status">
          {queueState.pending + queueState.failed} task action(s) awaiting confirmation; {queueState.conflicts} conflict(s); {queueState.rejected} rejected.
          {queueState.pending + queueState.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void resendPending()}>Resend</button> : null}
        </div>
      ) : null}

      {loadState === 'ready' && panel === 'board' ? (
        <>
          {taskWorkspace ? (
            <h2 className="search-results-meta">
              {taskWorkspace.kind === 'team' ? `Work · ${taskWorkspace.name}` : 'Personal'}
            </h2>
          ) : null}
          {otherTasks ? (
            <UserLoadSections
              load={otherTasks}
              empty="No tasks in this workspace."
              heading="h3"
              renderItems={(items) => (
                <ul>
                  {items.map((item) => (
                    <li key={`${item.workspaceId}:${item.value.id}`}>
                      <button type="button" className="btn-ghost" onClick={() => void openTaskWorkspace(item.workspaceId)}>
                        {item.value.title || 'Untitled task'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            />
          ) : null}
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
            onOpen={setEditingId}
          />
          {editingTask ? (
            <TaskEditor
              key={editingTask.id}
              task={editingTask}
              onPersist={persistTask}
              onClose={() => setEditingId(null)}
            />
          ) : null}
        </>
      ) : null}

      {loadState === 'ready' && panel === 'settings' ? (
        <StatusSettings handler={handler} onChange={apply} />
      ) : null}
    </div>
  );
}
