import { useState } from 'react';
import { StatusHandler } from './status-handler';

const COLOR_OPTIONS = [
  '#64748b',
  '#38bdf8',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fb7185',
  '#818cf8',
  '#2dd4bf',
  '#60a5fa',
];

interface StatusSettingsProps {
  handler: StatusHandler;
  onChange: (handler: StatusHandler) => void;
}

export function StatusSettings({ handler, onChange }: StatusSettingsProps) {
  const [newStatusName, setNewStatusName] = useState('');
  const statuses = handler.getStatuses();

  const addStatus = () => {
    const next = handler.addStatus(newStatusName);
    if (next.getBoard() !== handler.getBoard()) {
      onChange(next);
      setNewStatusName('');
    }
  };

  return (
    <section className="status-settings">
      <div className="status-settings-intro">
        <h2>Workflow statuses</h2>
        <p>
          Columns on the board mirror these statuses. Reorder them to change
          column layout. Removing a status moves its tasks to a neighbor column.
        </p>
      </div>

      <ul className="status-list">
        {statuses.map((status, index) => (
          <li key={status.id} className="status-row">
            <div className="status-row-order">
              <button
                type="button"
                className="btn-icon"
                aria-label={`Move ${status.name} earlier`}
                disabled={index === 0}
                onClick={() => onChange(handler.moveStatus(status.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Move ${status.name} later`}
                disabled={index === statuses.length - 1}
                onClick={() => onChange(handler.moveStatus(status.id, 1))}
              >
                ↓
              </button>
            </div>

            <span
              className="status-row-dot"
              style={{ background: status.color }}
              aria-hidden="true"
            />

            <label className="field field-grow">
              Name
              <input
                type="text"
                value={status.name}
                onChange={(e) =>
                  onChange(handler.updateStatus(status.id, { name: e.target.value }))
                }
              />
            </label>

            <fieldset className="status-color-fieldset">
              <legend>Color</legend>
              <div className="status-color-options">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={[
                      'status-color-swatch',
                      status.color === color && 'active',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ background: color }}
                    aria-label={`Set color ${color}`}
                    aria-pressed={status.color === color}
                    onClick={() =>
                      onChange(handler.updateStatus(status.id, { color }))
                    }
                  />
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              className="btn-danger btn-sm"
              disabled={statuses.length <= 1}
              onClick={() => onChange(handler.removeStatus(status.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="status-add-row">
        <label className="field field-grow">
          New status
          <input
            type="text"
            placeholder="e.g. Blocked"
            value={newStatusName}
            onChange={(e) => setNewStatusName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addStatus();
            }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={addStatus}>
          Add status
        </button>
      </div>
    </section>
  );
}
