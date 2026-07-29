import type { CSSProperties } from 'react';
import { StatusHandler, taskMatchesQuery } from './status-handler';
import { TaskCard } from './task-card';

interface KanbanBoardProps {
  handler: StatusHandler;
  searchQuery: string;
  onChange: (handler: StatusHandler) => void;
}

export function KanbanBoard({ handler, searchQuery, onChange }: KanbanBoardProps) {
  const statuses = handler.getStatuses();
  const isSearching = searchQuery.trim().length > 0;

  const handleDrop = (taskId: string, statusId: string) => {
    onChange(handler.moveTaskToStatus(taskId, statusId));
  };

  return (
    <div className="kanban-board">
      {statuses.map((status) => {
        const tasks = handler
          .getTasksForStatus(status.id)
          .filter((task) => taskMatchesQuery(task, searchQuery));
        return (
          <section
            key={status.id}
            className="kanban-column"
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('drop-target');
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('drop-target');
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('drop-target');
              const taskId = e.dataTransfer.getData('text/task-id');
              if (taskId) handleDrop(taskId, status.id);
            }}
          >
            <header
              className="kanban-column-header"
              style={{ '--status-color': status.color } as CSSProperties}
            >
              <span className="kanban-column-dot" aria-hidden="true" />
              <h2>{status.name}</h2>
              <span className="kanban-column-count">{tasks.length}</span>
            </header>

            <ul className="kanban-column-list">
              {tasks.length === 0 && isSearching ? (
                <li className="kanban-column-empty">No matches</li>
              ) : null}
              {tasks.map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    statuses={statuses}
                    onMove={(taskId, nextStatusId) =>
                      onChange(handler.moveTaskToStatus(taskId, nextStatusId))
                    }
                    onUpdate={(taskId, patch) =>
                      onChange(handler.updateTask(taskId, patch))
                    }
                    onRemove={(taskId) =>
                      onChange(handler.removeTask(taskId))
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
