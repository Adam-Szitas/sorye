import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLocale, registerPendingActionFlusher, switchAuthorizedWorkspace, translate, type MessageKey, type MessageParams } from '@sorye/platform';
import { useI18n, useKernel, useSignalValue, UserLoadSections } from '@sorye/platform/react';
import { findTaskByTicketId, taskImageIds, ticketIdFromInput, type TaskItem, type UserLoadPartition, type UserLoadWorkspace } from '@sorye/types';
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

function writeTicketSearch(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('ticket', id);
  else url.searchParams.delete('ticket');
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) window.history.replaceState(window.history.state, '', next);
}

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
    const sameImages = taskImageIds(before).join('\0') === taskImageIds(task).join('\0');
    if (before.title !== task.title || before.body !== task.body || !sameImages) {
      void emitTaskEvent(kernel, 'sorye.task.updated', {
        title: `Task updated: ${task.title}`,
        appId: 'tasks',
        entityId: task.id,
      });
    }
  }
}

/** Translate outside render (error state set from async callbacks). */
const tr = (key: MessageKey, params?: MessageParams) => translate(getLocale(), key, params);

export default function App() {
  const { t } = useI18n();
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
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskWorkspace, setTaskWorkspace] = useState<UserLoadWorkspace | null>(null);

  const refreshQueueState = useCallback(async () => {
    try {
      const state = await storage.queueState();
      setQueueState(state);
      if (state.conflicts > 0) {
        setSaveError(tr('tasks.conflict'));
        setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
      } else if (state.rejected > 0) setSaveError(tr('tasks.rejected'));
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
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error && err.message ? err.message : tr('tasks.loadFailed'));
          setLoadState('error');
        }
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
          setSaveError(err instanceof Error ? err.message : tr('tasks.saveFailed'));
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
    if (queueState.pending + queueState.failed > 0) setSaveError(tr('tasks.needsConfirmation'));
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
      setSaveError(tr('tasks.reloadFailed'));
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
      setSaveError(err instanceof Error ? err.message : tr('tasks.saveFailed'));
      if (storage.isConflict(err)) setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
      await refreshQueueState();
      throw err;
    }
  }, [board, handler, kernel, refreshQueueState, saveBoard, storage]);

  const openTicket = useCallback((raw: string) => {
    const id = ticketIdFromInput(raw);
    if (!id) {
      setTicketError(tr('tasks.ticketEnterId'));
      setEditingId(null);
      return;
    }
    const task = findTaskByTicketId(board.tasks, id);
    if (!task) {
      setTicketError(id.length > 80 ? tr('tasks.ticketNotFound') : tr('tasks.ticketNotFoundId', { id }));
      setEditingId(null);
      return;
    }
    setTicketError(null);
    ui.state.panel.value = 'board';
    setEditingId(task.id);
    writeTicketSearch(task.id);
  }, [board.tasks, ui]);

  const openedTicket = useRef<string | null>(null);
  useEffect(() => {
    if (loadState !== 'ready') return;
    const raw = new URLSearchParams(window.location.search).get('ticket');
    if (!raw) {
      openedTicket.current = null;
      return;
    }
    const id = ticketIdFromInput(raw);
    if (!id || openedTicket.current === id) return;
    openedTicket.current = id;
    openTicket(raw);
  }, [loadState, openTicket]);

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
              {t('tasks.board')}
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
              {t('tasks.statuses')}
            </button>
          </div>
        </div>
      </header>

      {loadState === 'loading' ? (
        <p className="search-results-meta">{t('tasks.loading')}</p>
      ) : null}
      {loadState === 'error' ? (
        <p className="search-results-meta" role="alert">
          {loadError ?? t('tasks.loadFailed')}
        </p>
      ) : null}
      {saveError ? (
        <div className="search-results-meta" role="alert">
          {saveError}
          {conflictDraftAvailable ? <div className="tasks-toolbar">
            <button type="button" className="btn-ghost" onClick={downloadConflictDraft}>{t('tasks.downloadDraft')}</button>
            <button type="button" className="btn-ghost" onClick={() => void discardDraftAndReload()}>{t('tasks.discardDraft')}</button>
          </div> : null}
        </div>
      ) : null}
      {(queueState.pending + queueState.failed + queueState.conflicts + queueState.rejected) > 0 ? (
        <div className="search-results-meta" role="status">
          {t('tasks.queueSummary', { waiting: queueState.pending + queueState.failed, conflicts: queueState.conflicts, rejected: queueState.rejected })}
          {queueState.pending + queueState.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void resendPending()}>{t('tasks.resend')}</button> : null}
        </div>
      ) : null}

      {loadState === 'ready' && panel === 'board' ? (
        <>
          {taskWorkspace ? (
            <h2 className="search-results-meta">
              {taskWorkspace.kind === 'team' ? t('tasks.workspaceWork', { name: taskWorkspace.name }) : t('tasks.workspacePersonal')}
            </h2>
          ) : null}
          {otherTasks ? (
            <UserLoadSections
              load={otherTasks}
              empty={t('tasks.empty')}
              heading="h3"
              renderItems={(items) => (
                <ul>
                  {items.map((item) => (
                    <li key={`${item.workspaceId}:${item.value.id}`}>
                      <button type="button" className="btn-ghost" onClick={() => void openTaskWorkspace(item.workspaceId)}>
                        {item.value.title || t('tasks.untitled')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            />
          ) : null}
          <div className="tasks-bar">
            <div className="tasks-add">
              <input
                type="text"
                className="bar-input"
                aria-label={t('tasks.newTask')}
                placeholder={t('tasks.addPlaceholder')}
                value={newTaskTitle}
                enterKeyHint="done"
                onChange={(e) => {
                  ui.state.newTaskTitle.value = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTask();
                }}
              />
              <button
                type="button"
                className="btn-primary tasks-add-btn"
                aria-label={t('tasks.addTask')}
                disabled={!newTaskTitle.trim()}
                onClick={addTask}
              >
                <span aria-hidden="true">+</span>
                <span className="tasks-add-label">{t('tasks.addTask')}</span>
              </button>
            </div>

            <div className="tasks-search">
              <svg className="bar-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                className="bar-input"
                aria-label={t('tasks.search')}
                placeholder={t('tasks.search')}
                value={searchQuery}
                onChange={(e) => {
                  ui.state.searchQuery.value = e.target.value;
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="btn-icon search-clear"
                  aria-label={t('tasks.clearSearch')}
                  onClick={() => {
                    ui.state.searchQuery.value = '';
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className={`btn-icon tasks-ticket-toggle${ticketOpen || ticketError ? ' active' : ''}`}
              aria-label={t('tasks.openTicketById')}
              aria-expanded={ticketOpen || Boolean(ticketError)}
              title={t('tasks.openTicketById')}
              onClick={() => setTicketOpen((open) => !open)}
            >
              #
            </button>
          </div>

          {ticketOpen || ticketError ? (
            <form
              className="tasks-ticket"
              onSubmit={(event) => {
                event.preventDefault();
                openTicket(ticketQuery);
              }}
            >
              <input
                type="text"
                className="bar-input"
                aria-label={t('tasks.ticketId')}
                placeholder={t('tasks.pasteTicket')}
                value={ticketQuery}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(event) => setTicketQuery(event.target.value)}
              />
              <button type="submit" className="btn-ghost">{t('open')}</button>
            </form>
          ) : null}
          {ticketError ? (
            <p className="search-results-meta" role="alert">{ticketError}</p>
          ) : null}
          {matchCount !== null ? (
            <p className="search-results-meta" aria-live="polite">
              {matchCount === 0
                ? t('tasks.matchNone')
                : matchCount === 1
                  ? t('tasks.matchOne')
                  : t('tasks.matchMany', { n: matchCount })}
            </p>
          ) : null}

          <KanbanBoard
            handler={handler}
            searchQuery={searchQuery}
            onChange={apply}
            onOpen={openTicket}
          />
          {editingTask ? (
            <TaskEditor
              key={editingTask.id}
              task={editingTask}
              statuses={handler.getStatuses()}
              onPersist={persistTask}
              onClose={() => {
                setEditingId(null);
                writeTicketSearch(null);
              }}
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
