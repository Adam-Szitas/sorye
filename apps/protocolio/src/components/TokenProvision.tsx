import { useState } from 'react';
import { provisionToken } from '../services/authService';

interface TokenProvisionProps {
  baseUrl: string;
  onProvisioned: (token: string) => void;
}

const STORAGE_KEY_TOKEN = 'protocolio_token';

export default function TokenProvision({ baseUrl, onProvisioned }: TokenProvisionProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleProvision() {
    setError('');
    setLoading(true);
    try {
      const res = await provisionToken(baseUrl);
      localStorage.setItem(STORAGE_KEY_TOKEN, res.token);
      onProvisioned(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <h2>Provision API Token</h2>
      <p className="section-hint">
        Simulates what a backend service does on first run: call <code>POST /api/auth/register</code>,
        store the token, then use it for PDF generation.
      </p>
      {error && <p className="badge red" style={{ marginTop: 8 }}>{error}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="primary" onClick={handleProvision} disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          Provision token
        </button>
      </div>
    </div>
  );
}
