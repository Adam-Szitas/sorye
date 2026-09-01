import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfTemplate } from '@protocolio/sdk';
import './styles.css';
import TokenProvision from './components/TokenProvision';
import ConnectionForm from './components/ConnectionForm';
import BlockPanel from './components/BlockPanel';
import PageSettingsPanel from './components/PageSettingsPanel';
import JsonEditor from './components/JsonEditor';
import ResultPanel from './components/ResultPanel';
import type { ResultState } from './components/ResultPanel';
import ActionToolbar from './components/ActionToolbar';
import PresetSelector from './components/PresetSelector';
import PipelineGuide from './components/PipelineGuide';
import {
  getClient,
  initClient,
  hasToken,
  getBaseUrl,
  generate as generatePdf,
  useHubBridge,
  bridgeHealth,
} from './services/clientService';
import * as TBS from './services/templateBuilderService';
import { mergePageSettings } from './defaults';
import { minimalPreset } from './presets';
import {
  fetchHandoff,
  fetchLatestProtocolioHandoff,
  isPdfTemplate,
  markHandoffConsumed,
  subscribeToHandoffs,
} from './handoff';

type EditorMode = 'visual' | 'json';
type Panel = 'builder' | 'json';

export default function App() {
  const [panel, setPanel] = useState<Panel>('builder');
  const [mode, setMode] = useState<EditorMode>('visual');
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const [builderVersion, setBuilderVersion] = useState(0);
  const [parseError, setParseError] = useState<string | undefined>();
  const [jsonParsed, setJsonParsed] = useState<PdfTemplate | null>(minimalPreset);
  const [showProvision, setShowProvision] = useState(false);
  const [connected, setConnected] = useState(true);
  const [tokenReady, setTokenReady] = useState(() => hasToken());
  const [jsonEditorKey, setJsonEditorKey] = useState(0);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);
  const handledHandoffRef = useRef<string | null>(null);

  const refreshBuilder = useCallback(() => {
    setBuilderVersion((v) => v + 1);
  }, []);

  const baseUrl = getBaseUrl();

  const ingestHandoff = useCallback(
    async (handoffId: string, opts?: { autoGenerate?: boolean }) => {
      if (handledHandoffRef.current === handoffId) return;
      const handoff = await fetchHandoff(handoffId);
      if (!handoff || !isPdfTemplate(handoff.payload)) return;

      handledHandoffRef.current = handoffId;
      const template = handoff.payload;
      TBS.loadTemplate(template);
      refreshBuilder();
      setJsonParsed(template);
      setJsonEditorKey((k) => k + 1);
      setParseError(undefined);
      setPanel('builder');
      setMode('visual');
      setHandoffNotice(
        `Loaded from OCR · ${handoff.title}${handoff.summary ? ` · ${handoff.summary}` : ''}`,
      );

      await markHandoffConsumed(handoffId);

      if (opts?.autoGenerate !== false && getClient() && hasToken()) {
        setResult({ status: 'loading' });
        try {
          const generated = await generatePdf(template);
          setResult({ status: 'generate-success', result: generated });
          setHandoffNotice(
            (prev) => `${prev ?? 'OCR handoff'} · PDF generated`,
          );
        } catch (err) {
          setResult({
            status: 'network-error',
            message:
              err instanceof Error
                ? err.message
                : 'Could not generate PDF from OCR handoff',
          });
        }
      }
    },
    [refreshBuilder],
  );

  useEffect(() => {
    useHubBridge(true);
    setTokenReady(hasToken());
    setConnected(true);
    void bridgeHealth().then((health) => {
      if (health.ok) {
        setBridgeStatus(
          `Developer bridge ready${health.apiUrl ? ` · ${health.apiUrl}` : ''}`,
        );
      } else {
        setBridgeStatus(
          health.detail
            ? `Bridge: ${health.detail}`
            : 'Bridge unreachable — start Protocolio API on PORT=3100',
        );
      }
    });
  }, []);

  useEffect(() => {
    TBS.loadTemplate(minimalPreset);
    refreshBuilder();
  }, [refreshBuilder]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const latest = await fetchLatestProtocolioHandoff();
      if (!cancelled && latest) {
        await ingestHandoff(latest.id, { autoGenerate: true });
      }
    })();

    const unsubscribe = subscribeToHandoffs((id) => {
      void ingestHandoff(id, { autoGenerate: true });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [ingestHandoff]);

  const handleProvisioned = useCallback(
    (token: string) => {
      initClient({ baseUrl, token });
      setConnected(true);
      setTokenReady(true);
      setShowProvision(false);
    },
    [baseUrl],
  );

  const handleConnect = useCallback(() => {
    useHubBridge(false);
    setConnected(true);
    setTokenReady(hasToken());
  }, []);

  const blocks = TBS.getBlocks();
  const builderJson =
    blocks.length > 0
      ? JSON.stringify(TBS.build(), null, 2)
      : JSON.stringify({ blocks: [] }, null, 2);

  function switchMode(newMode: EditorMode) {
    if (newMode === mode) return;
    if (newMode === 'json') {
      const next = blocks.length > 0 ? TBS.build() : jsonParsed;
      setJsonParsed(next);
      setJsonEditorKey((k) => k + 1);
      setParseError(undefined);
    } else if (jsonParsed) {
      TBS.loadTemplate(jsonParsed);
      refreshBuilder();
    }
    setMode(newMode);
  }

  function openPanel(next: Panel) {
    setPanel(next);
    if (next === 'json') switchMode('json');
    else switchMode('visual');
  }

  function handleJsonChange(template: PdfTemplate | null, _raw: string) {
    if (template) {
      setJsonParsed(template);
      setParseError(undefined);
    } else {
      setJsonParsed(null);
      try {
        JSON.parse(_raw);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      }
    }
  }

  function getTemplate(): PdfTemplate | null {
    if (mode === 'json') {
      if (!jsonParsed) return null;
      return {
        ...jsonParsed,
        page: mergePageSettings(jsonParsed.page),
      };
    }
    if (blocks.length === 0) return null;
    return TBS.build();
  }

  function handlePresetSelect(template: PdfTemplate) {
    TBS.loadTemplate(template);
    refreshBuilder();
    setJsonParsed(template);
    setJsonEditorKey((k) => k + 1);
    setParseError(undefined);
  }

  void builderVersion;

  return (
    <div className="protocolio-app">
      <header className="protocolio-header">
        <div>
          <h1>Protocolio</h1>
          <p>
            Full PdfTemplate builder — receives OCR layouts via workspace events
            and generates PDFs
          </p>
        </div>
        <div className="protocolio-header-actions">
          <span className="protocolio-badge">Developer</span>
          <div className="protocolio-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'builder' ? 'true' : 'false'}
              className={panel === 'builder' ? 'active' : undefined}
              onClick={() => openPanel('builder')}
            >
              Editor
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'json' ? 'true' : 'false'}
              className={panel === 'json' ? 'active' : undefined}
              onClick={() => openPanel('json')}
            >
              Payload JSON
            </button>
          </div>
        </div>
      </header>

      <div className="protocolio-builder">
        <PipelineGuide />

        {handoffNotice ? (
          <div className="section handoff-notice">
            <p>
              <span className="badge blue">OCR handoff</span> {handoffNotice}
            </p>
          </div>
        ) : null}

        {bridgeStatus ? (
          <div className="section handoff-notice">
            <p>
              <span className="badge green">Dev bridge</span> {bridgeStatus}
            </p>
          </div>
        ) : null}

        <ConnectionForm onConnect={handleConnect} onHealthResult={() => {}} />

        {!tokenReady && (
          <div className="section token-notice">
            <p>
              <span className="badge blue">Token required</span> Direct API mode
              needs a Bearer token. Prefer the Hub developer bridge (default), or
              provision / paste a token below.
            </p>
            <button type="button" onClick={() => setShowProvision((v) => !v)}>
              {showProvision ? 'Hide' : 'Provision token'}
            </button>
          </div>
        )}

        {showProvision && (
          <TokenProvision baseUrl={baseUrl} onProvisioned={handleProvisioned} />
        )}

        {!connected && (
          <div className="error-banner">
            Connect to the Protocolio API above before generating PDFs. You can
            still edit every template field and export JSON without a connection.
          </div>
        )}

        <PresetSelector onSelect={handlePresetSelect} />

        {panel === 'builder' ? (
          <>
            <BlockPanel
              blocks={blocks}
              defaultRowGap={TBS.getPageSettings()?.defaultRowGap ?? 12}
              defaultBlockGap={TBS.getPageSettings()?.defaultBlockGap}
              inverse={TBS.getPageSettings()?.inverse}
              pageSettings={TBS.getPageSettings()}
              onChange={refreshBuilder}
            />
            <PageSettingsPanel
              pageSettings={TBS.getPageSettings()}
              metadata={TBS.getMetadata()}
              defaultFont={TBS.getDefaultFont()}
              onChange={refreshBuilder}
            />
            <div className="protocolio-json-preview">
              <JsonEditor
                mode="visual"
                builderJson={builderJson}
                onTemplateChange={handleJsonChange}
                parseError={undefined}
                compact
              />
              <div className="protocolio-json-preview-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => openPanel('json')}
                >
                  Edit full JSON
                </button>
              </div>
            </div>
          </>
        ) : (
          <JsonEditor
            key={jsonEditorKey}
            mode="json"
            initialJson={
              jsonParsed ? JSON.stringify(jsonParsed, null, 2) : builderJson
            }
            onTemplateChange={handleJsonChange}
            parseError={parseError}
          />
        )}

        <ActionToolbar
          getTemplate={getTemplate}
          parseError={mode === 'json' ? parseError : undefined}
          onResult={setResult}
        />

        <ResultPanel result={result} />
      </div>
    </div>
  );
}
