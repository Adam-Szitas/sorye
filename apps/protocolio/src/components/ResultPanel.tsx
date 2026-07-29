import { useEffect, useState } from 'react';
import type { GenerateResult } from '@protocolio/sdk';

export type ResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'generate-success'; result: GenerateResult }
  | { status: 'validate-success' }
  | { status: 'validate-failure'; errors: string[] }
  | { status: 'protocolio-error'; statusCode: number; message: string }
  | { status: 'network-error'; message: string };

interface ResultPanelProps {
  result: ResultState;
}

export default function ResultPanel({ result }: ResultPanelProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result.status === 'generate-success') {
      const url = URL.createObjectURL(result.result.data);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setBlobUrl(null);
    }
  }, [result]);

  return (
    <div className="section result-panel">
      <h2>Result</h2>
      {result.status === 'idle' && <p style={{ color: '#888', fontSize: '0.85rem' }}>No operation performed yet.</p>}

      {result.status === 'loading' && (
        <p><span className="spinner" />Processing...</p>
      )}

      {result.status === 'generate-success' && (
        <div>
          <div className="success-banner">
            PDF generated: <strong>{result.result.filename}</strong> in {result.result.generationTimeMs}ms
          </div>
          {blobUrl && <iframe title="PDF Preview" src={blobUrl} className="pdf-preview" />}
        </div>
      )}

      {result.status === 'validate-success' && (
        <div className="success-banner"><span className="badge green">Valid</span> Template is valid.</div>
      )}

      {result.status === 'validate-failure' && (
        <div>
          <div className="error-banner"><span className="badge red">Invalid</span> Validation failed</div>
          <ul className="error-list">
            {result.errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {result.status === 'protocolio-error' && (
        <div className="error-banner">
          <span className="badge red">Error {result.statusCode}</span> {result.message}
        </div>
      )}

      {result.status === 'network-error' && (
        <div className="error-banner">
          Network Error: {result.message}
        </div>
      )}
    </div>
  );
}
