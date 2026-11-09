import { switchAuthorizedWorkspace } from '@sorye/platform';
import { UserLoadSections } from '@sorye/platform/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserLoadPartition } from '@sorye/types';
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
const LEGACY_DRAFT_KEY = 'sorye:protocolio:draft:v1';

function draftStorageKey(workspaceId: string) {
  return `${LEGACY_DRAFT_KEY}:${workspaceId}`;
}

interface DraftWorkspace {
  id: string;
  name: string;
  kind: 'personal' | 'team';
}

interface SavedDraft {
  version: 1;
  template: PdfTemplate;
  panel: Panel;
  mode: EditorMode;
  jsonText: string;
}

function readSavedDraft(key: string): SavedDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedDraft>;
    if (
      value.version !== 1 ||
      !value.template ||
      !Array.isArray(value.template.blocks) ||
      (value.panel !== 'builder' && value.panel !== 'json') ||
      (value.mode !== 'visual' && value.mode !== 'json') ||
      typeof value.jsonText !== 'string'
    ) return null;
    return value as SavedDraft;
  } catch {
    return null;
  }
}

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
  const [jsonText, setJsonText] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftWorkspaces, setDraftWorkspaces] = useState<DraftWorkspace[]>([]);
  const [personalPackageAppIds, setPersonalPackageAppIds] = useState<string[] | null>(null);
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
      setJsonText(JSON.stringify(template, null, 2));
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
          `PDF service ready${health.apiUrl ? ` · ${health.apiUrl}` : ''}`,
        );
      } else {
        setBridgeStatus(
          health.detail
            ? `Bridge: ${health.detail}`
            : 'PDF service unavailable. Please try again later.',
        );
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let activeId = 'local';
      let list: DraftWorkspace[] = [];
      try {
        const res = await fetch('/api/workspace', { credentials: 'include' });
        if (res.ok) {
          const session = (await res.json()) as {
            workspace?: { id?: string };
            workspaces?: DraftWorkspace[];
            personalPackageAppIds?: string[];
          };
          if (session.workspace?.id) activeId = session.workspace.id;
          if (!cancelled && Array.isArray(session.personalPackageAppIds)) {
            setPersonalPackageAppIds(session.personalPackageAppIds);
          }
          if (Array.isArray(session.workspaces)) {
            list = session.workspaces.filter(
              (workspace) =>
                Boolean(workspace?.id) &&
                (workspace.kind === 'personal' || workspace.kind === 'team'),
            );
          }
        }
      } catch {
        // Keep the editor usable when the session request fails.
      }
      if (cancelled) return;
      const key = draftStorageKey(activeId);
      try {
        if (!window.localStorage.getItem(key)) {
          const legacy = window.localStorage.getItem(LEGACY_DRAFT_KEY);
          if (legacy) {
            window.localStorage.setItem(key, legacy);
            window.localStorage.removeItem(LEGACY_DRAFT_KEY);
          }
        }
      } catch {
        // Storage can be disabled.
      }
      setDraftKey(key);
      setDraftWorkspaces(list);
      const saved = readSavedDraft(key);
      const template = saved?.template ?? minimalPreset;
      TBS.loadTemplate(template);
      if (saved) {
        setPanel(saved.panel);
        setMode(saved.mode);
        setJsonParsed(template);
        setJsonText(saved.jsonText);
      } else {
        setJsonParsed(minimalPreset);
        setJsonText(JSON.stringify(minimalPreset, null, 2));
      }
      refreshBuilder();
      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBuilder]);

  useEffect(() => {
    if (!draftReady || !draftKey) return;
    const template = mode === 'json' && jsonParsed ? jsonParsed : TBS.build();
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        template,
        panel,
        mode,
        jsonText,
      } satisfies SavedDraft));
    } catch {
      // Storage can be disabled or full; the live editor remains usable.
    }
  }, [draftReady, draftKey, builderVersion, panel, mode, jsonParsed, jsonText]);

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
      if (next) setJsonText(JSON.stringify(next, null, 2));
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
    setJsonText(_raw);
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
    setJsonText(JSON.stringify(template, null, 2));
    setJsonEditorKey((k) => k + 1);
    setParseError(undefined);
  }

  void builderVersion;

  const draftLoad = useMemo<UserLoadPartition<{ title: string }>>(() => {
    const groupFor = (workspace: DraftWorkspace) => {
      const saved = readSavedDraft(draftStorageKey(workspace.id));
      const named = saved?.template as { name?: unknown } | undefined;
      const title = typeof named?.name === 'string' && named.name
        ? named.name
        : saved
          ? 'Untitled draft'
          : '';
      return {
        workspace,
        items: title
          ? [{
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              workspaceKind: workspace.kind,
              value: { title },
            }]
          : [],
      };
    };
    const personalAllowed =
      personalPackageAppIds === null || personalPackageAppIds.includes('protocolio');
    return {
      personal: personalAllowed
        ? draftWorkspaces.filter((workspace) => workspace.kind === 'personal').map(groupFor)
        : [],
      work: [...draftWorkspaces.filter((workspace) => workspace.kind === 'team')]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(groupFor),
    };
  }, [draftWorkspaces, draftReady, builderVersion, panel, mode, jsonText, personalPackageAppIds]);

  return (
    <div className="protocolio-app">
      <header className="protocolio-header">
        <div className="protocolio-header-actions">
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
        {draftWorkspaces.length > 0 ? (
          <UserLoadSections
            load={draftLoad}
            empty="No draft in this workspace."
            heading="h2"
            renderItems={(items) => (
              <ul>
                {items.map((item) => (
                  <li key={item.workspaceId}>
                    <button
                      type="button"
                      onClick={() => {
                        if (draftStorageKey(item.workspaceId) === draftKey) return;
                        void switchAuthorizedWorkspace(item.workspaceId).then((ok) => {
                          if (ok) window.location.reload();
                        });
                      }}
                    >
                      {item.value.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          />
        ) : null}
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
              <span className="badge green">PDF service</span> {bridgeStatus}
            </p>
          </div>
        ) : null}

        {!connected && (
          <div className="error-banner">
            The PDF service is unavailable. You can
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
            initialJson={jsonText || (jsonParsed ? JSON.stringify(jsonParsed, null, 2) : builderJson)}
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
