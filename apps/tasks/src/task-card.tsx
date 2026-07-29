import { Select } from '@sorye/sdk/react';
import { useState } from 'react';
import type { TaskItem, TaskStatus } from './status-handler';

interface TaskCardProps {
  task: TaskItem;
  statuses: TaskStatus[];
  onMove: (taskId: string, statusId: string) => void;
  onUpdate: (taskId: string, patch: Partial<Pick<TaskItem, 'title' | 'body'>>) => void;
  onRemove: (taskId: string) => void;
}

export function TaskCard({
  task,
  statuses,
  onMove,
  onUpdate,
  onRemove,
}: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className="task-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="task-card-top">
        <button
          type="button"
          className="task-card-title"
          onClick={() => setExpanded((open) => !open)}
        >
          {task.title}
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label="Remove task"
          onClick={() => onRemove(task.id)}
        >
          ×
        </button>
      </div>

      {expanded ? (
        <label className="field">
          Notes
          <textarea
            value={task.body}
            rows={3}
            placeholder="Add details..."
            onChange={(e) => onUpdate(task.id, { body: e.target.value })}
          />
        </label>
      ) : task.body ? (
        <p className="task-card-preview">{task.body}</p>
      ) : null}

      <Select
        compact
        label="Status"
        value={task.statusId}
        options={statuses.map((status) => ({
          value: status.id,
          label: status.name,
        }))}
        onSoryeChange={(e) => onMove(task.id, e.detail.value)}
      />
    </article>
  );
}
