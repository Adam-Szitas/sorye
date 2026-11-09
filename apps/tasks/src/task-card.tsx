import { Select } from '@sorye/sdk/react';
import type { TaskItem, TaskStatus } from './status-handler';
import { taskPhotoUrl } from './task-photo';

interface TaskCardProps {
  task: TaskItem;
  statuses: TaskStatus[];
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, statusId: string) => void;
  onRemove: (taskId: string) => void;
}

export function TaskCard({ task, statuses, onOpen, onMove, onRemove }: TaskCardProps) {
  const photo = taskPhotoUrl(task.driveFileId);

  return (
    <article
      className="task-card"
      draggable
      onDragStart={(event) => {
        const origin = event.target;
        if (origin instanceof Element && origin.closest('sorye-select, [data-no-drag], img')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.setData('application/x-sorye-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(event) => {
        const origin = event.target;
        if (!(origin instanceof Element) || origin.closest('sorye-select, [data-no-drag]')) return;
        onOpen(task.id);
      }}
    >
      <div className="task-card-top">
        <button type="button" className="task-card-title" onClick={() => onOpen(task.id)}>
          {task.title}
        </button>
        <button
          type="button"
          className="btn-icon"
          data-no-drag=""
          aria-label="Remove task"
          onClick={() => onRemove(task.id)}
        >
          ×
        </button>
      </div>

      {photo ? (
        <img className="task-card-photo" src={photo} alt="" width={320} height={180} decoding="async" draggable={false} />
      ) : null}
      {task.body ? <p className="task-card-preview">{task.body}</p> : null}

      <div data-no-drag="">
        <Select
          compact
          label="Status"
          value={task.statusId}
          options={statuses.map((status) => ({
            value: status.id,
            label: status.name,
          }))}
          onSoryeChange={(event) => {
            const next = event.detail.value;
            if (next && next !== task.statusId) onMove(task.id, next);
          }}
        />
      </div>
    </article>
  );
}
