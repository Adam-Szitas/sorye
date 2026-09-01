import { useState, useEffect } from 'react';
import type { ProtocolioConfig } from '@protocolio/sdk';
import * as ClientService from '../services/clientService';
import { resolveApiBaseUrl, resolveDevToken, DEV_TOKEN } from '../config';

interface ConnectionFormProps {
  onConnect: (config: ProtocolioConfig) => void;
  onHealthResult?: (reachable: boolean) => void;
}

export default function ConnectionForm({ onConnect, onHealthResult }: ConnectionFormProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [healthStatus, setHealthStatus] = useState<'idle' | 'loading' | 'reachable' | 'unreachable'>('idle');

  useEffect(() => {
    const url = resolveApiBaseUrl();
    const tok = resolveDevToken();
    setBaseUrl(url);
    setToken(tok);

    if (tok) {
      const config: ProtocolioConfig = { baseUrl: url, token: tok };
      ClientService.initClient(config);
      onConnect(config);
    }
  }, [onConnect]);

  const isBaseUrlEmpty = baseUrl.trim().length === 0;
  const usingDevToken = DEV_TOKEN && token === DEV_TOKEN;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isBaseUrlEmpty) return;
    const config: ProtocolioConfig = { baseUrl: baseUrl.trim(), token: token.trim() };
    ClientService.initClient(config);
    onConnect(config);
  }

  async function handleHealthCheck() {
    setHealthStatus('loading');
    try {
      const reachable = await ClientService.health();
      setHealthStatus(reachable ? 'reachable' : 'unreachable');
      onHealthResult?.(reachable);
    } catch {
      setHealthStatus('unreachable');
      onHealthResult?.(false);
    }
  }

  return (
    <div className="section">
      <h2>API Connection</h2>
      <p className="section-hint">
        Use the Hub developer bridge by default (no browser Bearer token).
        Optional: connect directly to the Protocolio API with a token below.
        {usingDevToken && (
          <> Dev token is pre-filled for direct mode.</>
        )}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="row">
          <div>
            <label htmlFor="baseUrl">Base URL</label>
            <input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="http://localhost:5173"
            />
          </div>
          <div>
            <label htmlFor="token">Bearer Token</label>
            <input
              id="token"
              type="text"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="paste token from your backend or provision below"
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="submit" className="primary" disabled={isBaseUrlEmpty}>Connect</button>
          <button type="button" onClick={handleHealthCheck}>
            {healthStatus === 'loading' && <span className="spinner" />}
            Health Check
          </button>
          {healthStatus === 'reachable' && <span className="badge green">API reachable</span>}
          {healthStatus === 'unreachable' && <span className="badge red">API unreachable</span>}
        </div>
      </form>
    </div>
  );
}
