import { useState } from 'react';
import { ProtocolioError } from '@protocolio/sdk';
import type { PdfTemplate } from '@protocolio/sdk';
import * as ClientService from '../services/clientService';
import type { ResultState } from './ResultPanel';
import { commitFocusedInputs } from './DeferredNumberInput';

interface ActionToolbarProps {
  getTemplate: () => PdfTemplate | null;
  parseError: string | undefined;
  onResult: (result: ResultState) => void;
}

export default function ActionToolbar({ getTemplate, parseError, onResult }: ActionToolbarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [filename, setFilename] = useState('');

  const hasClient = !!ClientService.getClient();
  const hasToken = ClientService.hasToken();
  const disabled = !!loading || !!parseError;
  const actionsDisabled = disabled || !hasClient || !hasToken;

  async function handleGenerate() {
    await commitFocusedInputs();
    const template = getTemplate();
    if (!template) return;
    setLoading('generate');
    onResult({ status: 'loading' });
    try {
      const result = await ClientService.generate(template);
      onResult({ status: 'generate-success', result });
    } catch (err) {
      onResult(toErrorResult(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleDownload() {
    await commitFocusedInputs();
    const template = getTemplate();
    if (!template) return;
    setLoading('download');
    onResult({ status: 'loading' });
    try {
      await ClientService.download(template, filename || undefined);
      onResult({ status: 'idle' });
    } catch (err) {
      onResult(toErrorResult(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleValidate() {
    await commitFocusedInputs();
    const template = getTemplate();
    if (!template) return;
    setLoading('validate');
    onResult({ status: 'loading' });
    try {
      const result = await ClientService.validate(template);
      if (result.valid) {
        onResult({ status: 'validate-success' });
      } else {
        onResult({ status: 'validate-failure', errors: result.errors });
      }
    } catch (err) {
      onResult(toErrorResult(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleHealth() {
    setLoading('health');
    onResult({ status: 'loading' });
    try {
      const reachable = await ClientService.health();
      if (reachable) {
        onResult({ status: 'validate-success' });
      } else {
        onResult({ status: 'network-error', message: 'API is unreachable' });
      }
    } catch (err) {
      onResult(toErrorResult(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="section">
      <h2>Actions</h2>
      <div className="toolbar">
        <button className="primary" onClick={handleGenerate} disabled={actionsDisabled}>
          {loading === 'generate' && <span className="spinner" />}Generate PDF
        </button>
        <button onClick={handleDownload} disabled={actionsDisabled}>
          {loading === 'download' && <span className="spinner" />}Download PDF
        </button>
        <input type="text" value={filename} onChange={e => setFilename(e.target.value)} placeholder="filename.pdf" style={{ width: 160, flex: 'none' }} />
        <button onClick={handleValidate} disabled={actionsDisabled}>
          {loading === 'validate' && <span className="spinner" />}Validate
        </button>
        <button onClick={handleHealth} disabled={!!loading || !hasClient}>
          {loading === 'health' && <span className="spinner" />}Health Check
        </button>
      </div>
      {parseError && <div className="error-banner">Cannot run actions: JSON is invalid</div>}
      {!hasToken && hasClient && (
        <div className="error-banner">Add a Bearer token above to validate or generate PDFs.</div>
      )}
    </div>
  );
}

function toErrorResult(err: unknown): ResultState {
  if (err instanceof ProtocolioError) {
    return { status: 'protocolio-error', statusCode: err.status, message: err.message };
  }
  return { status: 'network-error', message: err instanceof Error ? err.message : String(err) };
}
