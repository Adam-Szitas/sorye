import { TranslatedText } from '@sorye/platform/react';
import {
  probeWebGpu,
  readLocalGpuPreference,
  runWebGpuOcrPatternExtraction,
  subscribeGpuPreference,
  writeLocalGpuPreference,
} from '@sorye/platform';
import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import { Button } from '@sorye/sdk/react';
import { uploadToDrive } from '@sorye/sdk/files';
import { JsonDocument } from '@sorye/sdk/react/document-reading';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_USER_GPU_PREFERENCE,
  HUB_OPEN_APP_EVENT,
  hubOpenTargetKey,
  type HubOpenAppDetail,
  type LlmExecutionTarget,
  type OcrAnalysis,
  type OcrMatrix,
  type OcrPageLayout,
  type UserGpuPreference,
  type WebGpuDeviceDescriptor,
} from '@sorye/types';
import {
  DocumentPagesPreview,
  type OcrPageLayoutView,
} from './item-tables';
import {
  buildPageLayout,
  layoutFromPlainText,
  layoutHasContent,
} from './layout-matrix';
import {
  canvasToPreviewUrl,
  isAcceptedUpload,
  prepareFileForOcr,
} from './prepare-file';
import { clearPdfCache, getPdfPageCount } from './prepare-pdf';
import { runOcr, warmOcrEngine } from './ocr-engine';
import { sendLayoutToProtocolio } from './send-to-protocolio';
import { emitWorkspaceEvent } from './emit-event';
import { hubApiPath } from './hub-origin';
import {
  chooseFromJob,
  chooseOcrResume,
  readStoredLaunch,
  type OcrLaunchTarget,
  type OcrResumeChoice,
  type OcrResumeJob,
} from './resume-target';
import { GpuClock } from './gpu-clock';
import { ReadingView } from './reading-view';
import { LibraryPanel } from './library-panel';
import { CombinedReading, type ComparisonAnalysis, type ComparisonDocument } from './combined-reading';
import { downloadCsv, layoutsToCsv } from './export-csv';
import './styles.css';

const COMPARISON_STORAGE_KEY = 'sorye:ocr:comparison:v1';

async function followAnalysis(
  start: OcrAnalysis,
  onProgress: (analysis: OcrAnalysis) => void,
): Promise<OcrAnalysis> {
  let current = start;
  onProgress(current);
  rememberReading(current.id);
  let guard = 0;
  while (current.status === 'extracting' && guard < 10_000) {
    guard += 1;
    const before = current.vector?.cursor?.next ?? 0;
    await delay(1_200);
    current = await continueAnalysis(current.id);
    onProgress(current);
    const after = current.vector.cursor?.next ?? before;
    if (current.status === 'extracting' && after === before) {
      throw new Error('Qwen made no progress on this document.');
    }
  }
  return current;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => window.setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(stoppedError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(stoppedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function stoppedError(): DOMException {
  return new DOMException('Stopped following this analysis', 'AbortError');
}

function stopped(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function rememberReading(id: string) {
  try {
    sessionStorage.setItem('sorye.ocr.reading', id);
  } catch {
    // The hub frame can block storage. The reading still continues in this tab.
  }
}

function acknowledgeJob(jobId: string) {
  void fetch(hubApiPath('/api/ocr/active'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  }).catch(() => {});
}

async function fetchOcrAnalysis(id: string, signal?: AbortSignal): Promise<OcrAnalysis | null> {
  const analysisResponse = await fetch(hubApiPath(`/api/ocr/analyses/${encodeURIComponent(id)}`), {
    credentials: 'include', cache: 'no-store', signal,
  });
  const data = (await analysisResponse.json().catch(() => ({}))) as { analysis?: OcrAnalysis };
  if (!analysisResponse.ok || !data.analysis) return null;
  return data.analysis;
}

async function fetchResumeJob(jobId: string, signal?: AbortSignal): Promise<OcrResumeJob | null> {
  const response = await fetch(hubApiPath(`/api/jobs/${encodeURIComponent(jobId)}`), {
    credentials: 'include', cache: 'no-store', signal,
  });
  if (!response.ok) return null;
  const job = (await response.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    error?: string | null;
    result?: { analysisId?: string; presented?: boolean };
  };
  return {
    id: job.id || jobId,
    status: job.status || 'failed',
    error: job.error,
    analysisId: typeof job.result?.analysisId === 'string' ? job.result.analysisId : null,
    presented: job.result?.presented === true,
  };
}

async function pollOcrJob(
  jobId: string,
  onQueued: (status: string, gpuStartedAt?: string) => void,
  shouldContinue: () => boolean,
  signal?: AbortSignal,
): Promise<OcrAnalysis> {
  const jobPath = hubApiPath(`/api/jobs/${encodeURIComponent(jobId)}`);
  for (;;) {
    if (signal?.aborted || !shouldContinue()) throw stoppedError();
    const jobResponse = await fetch(jobPath, { credentials: 'include', cache: 'no-store', signal });
    const job = (await jobResponse.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
      result?: { analysisId?: string; phase?: string; completed?: number; total?: number; gpuStartedAt?: string };
    };
    if (!jobResponse.ok) throw new Error(job.error || `Could not check analysis (${jobResponse.status})`);
    if (job.status === 'failed' || job.status === 'cancelled') {
      const failure = new Error(job.error || (job.status === 'cancelled' ? 'Analysis was cancelled' : 'Analysis failed')) as Error & { analysisId?: string };
      failure.analysisId = job.result?.analysisId;
      throw failure;
    }
    const progress = job.result;
    const gpuStartedAt = progress?.phase === 'analyzing' ? progress.gpuStartedAt : undefined;
    if (job.status === 'running') {
      onQueued(progress?.phase === 'analyzing' && progress.total
        ? `Qwen is reading section ${Math.min((progress.completed ?? 0) + 1, progress.total)} of ${progress.total}.`
        : progress?.phase === 'reading_pdf' ? 'Extracting rows from the PDF…' : 'Waiting for an OCR worker…',
      gpuStartedAt);
    } else {
      onQueued('Waiting for an OCR worker…');
    }
    if (job.status === 'completed' && progress?.analysisId) {
      const analysis = await fetchOcrAnalysis(progress.analysisId, signal);
      if (!analysis) throw new Error('The analysis finished but could not be loaded');
      rememberReading(analysis.id);
      return analysis;
    }
    await delay(1_500, signal);
  }
}

async function submitAndFollowAnalysis(
  body: FormData,
  onAnalysisProgress?: (analysis: OcrAnalysis) => void,
  onQueued?: (status: string, gpuStartedAt?: string) => void,
  onJobCreated?: (jobId: string | null) => void,
  executionTarget: LlmExecutionTarget = 'hub-server',
  shouldContinue: () => boolean = () => true,
  signal?: AbortSignal,
): Promise<OcrAnalysis> {
  if (executionTarget === 'client-webgpu') {
    body.set('executionTarget', 'client-webgpu');
    const extractRes = await fetch(hubApiPath('/api/ocr/analyze?executionTarget=client-webgpu'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body,
    });
    const extracted = (await extractRes.json().catch(() => ({}))) as {
      error?: string;
      analysis?: OcrAnalysis;
    };
    if (!extractRes.ok || !extracted.analysis) {
      throw new Error(extracted.error || `Row extraction failed (${extractRes.status})`);
    }
    const baseAnalysis = extracted.analysis;
    onAnalysisProgress?.(baseAnalysis);

    const webGpuResult = await runWebGpuOcrPatternExtraction(baseAnalysis.pages, {
      onGpuStart: (startedAt) => onQueued?.('Running Qwen pattern pass on your WebGPU…', startedAt),
      onProgress: (_done, _total, detail) => onQueued?.(detail),
    });

    const patchRes = await fetch(
      hubApiPath(`/api/ocr/analyses/${encodeURIComponent(baseAnalysis.id)}/pattern`),
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webGpuResult),
      },
    );
    const finalized = (await patchRes.json().catch(() => ({}))) as {
      error?: string;
      analysis?: OcrAnalysis;
    };
    if (!patchRes.ok || !finalized.analysis) {
      throw new Error(finalized.error || `Could not save WebGPU pattern (${patchRes.status})`);
    }
    rememberReading(finalized.analysis.id);
    return finalized.analysis;
  }

  const response = await fetch(hubApiPath('/api/ocr/analyze'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body,
  });
  const submitted = (await response.json().catch(() => ({}))) as {
    error?: string;
    analysis?: OcrAnalysis;
    jobId?: string;
  };
  if (!response.ok) throw new Error(submitted.error || `Analysis failed (${response.status})`);
  onJobCreated?.(submitted.jobId ?? null);
  if (submitted.analysis) return followAnalysis(submitted.analysis, onAnalysisProgress ?? (() => {}));
  if (!submitted.jobId) throw new Error(submitted.error || 'The analysis was not accepted');
  return pollOcrJob(submitted.jobId, onQueued ?? (() => {}), shouldContinue, signal);
}

async function continueAnalysis(id: string, tries = 0): Promise<OcrAnalysis> {
  const res = await fetch(hubApiPath(`/api/ocr/analyses/${id}/continue`), {
    method: 'POST',
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    analysis?: OcrAnalysis;
  };
  if (res.status === 429) {
    if (tries > 8) throw new Error(data.error || 'OCR is busy. The saved rows can be continued later.');
    const wait = Number(res.headers.get('Retry-After') || '2');
    await delay((Number.isFinite(wait) ? wait : 2) * 1000);
    return continueAnalysis(id, tries + 1);
  }
  if (!res.ok || !data.analysis) {
    throw new Error(data.error || `Analysis failed (${res.status})`);
  }
  return data.analysis;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface PageScan {
  page: number;
  result: OcrMatrix;
  previewUrl: string;
}

function layoutFromResult(result: OcrMatrix): OcrPageLayout {
  if (layoutHasContent(result.layout)) return result.layout;

  const words = result.cells.flatMap((cell) => cell.words);
  if (words.length > 0) {
    const rebuilt = buildPageLayout(words, result.source.processedWidth);
    if (layoutHasContent(rebuilt)) return rebuilt;
  }

  return layoutFromPlainText(result.rawText);
}

function hasReadableText(result: OcrMatrix): boolean {
  if (result.rawText.trim()) return true;
  return result.matrix.some((row) => row.some((cell) => cell.trim()));
}

function buildDisplayPages(scans: PageScan[]): OcrPageLayoutView[] {
  return scans
    .map((scan) => ({
      page: scan.page,
      layout: layoutFromResult(scan.result),
    }))
    .filter((entry) => layoutHasContent(entry.layout));
}

function countFilledCells(layout: OcrPageLayout): number {
  return layout.rows.reduce(
    (sum, row) => sum + row.cells.filter((c) => c.text.trim()).length,
    0,
  );
}

function revokePreviewUrls(scans: PageScan[]): void {
  for (const scan of scans) {
    URL.revokeObjectURL(scan.previewUrl);
  }
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const compareFilesRef = useRef<HTMLInputElement>(null);
  const uploadedFileRef = useRef<File | null>(null);
  const driveFileIdRef = useRef<string | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const pageScansRef = useRef<PageScan[]>([]);
  const jobRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pageScans, setPageScans] = useState<PageScan[]>([]);
  const [viewPage, setViewPage] = useState(1);
  const [scanPage, setScanPage] = useState(1);
  const [scanPageCount, setScanPageCount] = useState(0);
  const [displayPages, setDisplayPages] = useState<OcrPageLayoutView[]>([]);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<OcrAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const watchRef = useRef(0);
  const followAbort = useRef<AbortController | null>(null);
  const pendingAck = useRef<string | null>(null);
  const [gpuStartedAt, setGpuStartedAt] = useState<string | null>(null);
  const [comparisonDocuments, setComparisonDocuments] = useState<ComparisonDocument[]>([]);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonProgress, setComparisonProgress] = useState('');
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonRestored, setComparisonRestored] = useState(false);
  const [gpuPref, setGpuPref] = useState<UserGpuPreference>(DEFAULT_USER_GPU_PREFERENCE);
  const [webGpuInfo, setWebGpuInfo] = useState<WebGpuDeviceDescriptor | null>(null);

  useEffect(() => {
    const initial = readLocalGpuPreference();
    setGpuPref(initial);
    void probeWebGpu(initial.webGpuPowerPreference).then(setWebGpuInfo);
    void fetch(hubApiPath('/api/llm/preferences'), { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { preference?: UserGpuPreference } | null) => {
        if (data?.preference) {
          const synced = writeLocalGpuPreference(data.preference);
          setGpuPref(synced);
        }
      })
      .catch(() => {});
    return subscribeGpuPreference((next) => {
      setGpuPref(next);
      void probeWebGpu(next.webGpuPowerPreference).then(setWebGpuInfo);
    });
  }, []);

  function switchOcrGpuTarget(target: LlmExecutionTarget) {
    const next = writeLocalGpuPreference({ target });
    setGpuPref(next);
    void fetch(hubApiPath('/api/llm/preferences'), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }

  useEffect(() => {
    pageScansRef.current = pageScans;
  }, [pageScans]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let saved: { ids?: unknown; selectedIds?: unknown } = {};
      try {
        saved = JSON.parse(localStorage.getItem(COMPARISON_STORAGE_KEY) ?? '{}');
      } catch {
        // Ignore an invalid comparison list and let the user start a new one.
      }
      const ids = Array.isArray(saved.ids)
        ? saved.ids.filter((id): id is string => typeof id === 'string').slice(-10)
        : [];
      const selectedIds = new Set(
        Array.isArray(saved.selectedIds)
          ? saved.selectedIds.filter((id): id is string => typeof id === 'string')
          : ids,
      );
      const restored = await Promise.all(ids.map(async (id) => {
        try {
          const response = await fetch(hubApiPath(`/api/ocr/analyses/${encodeURIComponent(id)}?view=matrix`), {
            credentials: 'include',
          });
          if (!response.ok) return null;
          const data = (await response.json()) as { analysis?: ComparisonAnalysis };
          if (!data.analysis || data.analysis.status === 'extracting') return null;
          return { analysis: data.analysis, selected: selectedIds.has(id) };
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        setComparisonDocuments(restored.filter((item): item is ComparisonDocument => item !== null));
        setComparisonRestored(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!comparisonRestored) return;
    try {
      localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify({
        ids: comparisonDocuments.slice(-10).map((item) => item.analysis.id),
        selectedIds: comparisonDocuments.filter((item) => item.selected).slice(-10).map((item) => item.analysis.id),
      }));
    } catch {
      // Comparisons remain usable if browser storage is unavailable.
    }
  }, [comparisonDocuments, comparisonRestored]);

  const noteFinished = useCallback((jobId?: string) => {
    if (!jobId) return;
    pendingAck.current = jobId;
    const node = rootRef.current;
    if (!node || document.visibilityState === 'hidden' || node.getClientRects().length === 0) return;
    pendingAck.current = null;
    acknowledgeJob(jobId);
  }, []);

  const presentChoice = useCallback(async (
    choice: OcrResumeChoice,
    signal: AbortSignal,
    shouldContinue: () => boolean,
  ) => {
    if (signal.aborted || !shouldContinue() || choice.action === 'none') return;
    if (choice.action === 'show') {
      setAnalyzing(false);
      setAnalysisProgress('');
      const loaded = await fetchOcrAnalysis(choice.analysisId, signal);
      if (signal.aborted || !shouldContinue()) return;
      if (loaded?.status === 'extracting' && choice.jobId) {
        await presentChoice({ action: 'poll', jobId: choice.jobId }, signal, shouldContinue);
        return;
      }
      if (!loaded || loaded.status === 'extracting') {
        setAnalysis(null);
        setAnalysisError('The analysis finished but could not be loaded');
        return;
      }
      setAnalysisError(null);
      setAnalysis(loaded);
      if (loaded.vector?.gpuStartedAt) setGpuStartedAt(loaded.vector.gpuStartedAt);
      rememberReading(loaded.id);
      noteFinished(choice.jobId);
      return;
    }
    if (choice.action === 'error') {
      setAnalyzing(false);
      setAnalysisProgress('');
      setAnalysisJobId(null);
      setAnalysisError(choice.message);
      if (choice.analysisId) {
        const loaded = await fetchOcrAnalysis(choice.analysisId, signal).catch(() => null);
        if (!signal.aborted && shouldContinue() && loaded && loaded.status !== 'extracting') {
          setAnalysis(loaded);
          rememberReading(loaded.id);
        }
      }
      noteFinished(choice.jobId);
      return;
    }
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisJobId(choice.jobId);
    try {
      const loaded = await pollOcrJob(choice.jobId, (status, started) => {
        if (!shouldContinue()) return;
        if (started) setGpuStartedAt(started);
        setAnalysisProgress(status);
      }, shouldContinue, signal);
      if (signal.aborted || !shouldContinue()) return;
      setAnalysis(loaded);
      if (loaded.vector?.gpuStartedAt) setGpuStartedAt(loaded.vector.gpuStartedAt);
      setAnalyzing(false);
      setAnalysisProgress('');
      setAnalysisJobId(null);
      noteFinished(choice.jobId);
    } catch (err) {
      if (signal.aborted || !shouldContinue() || stopped(err)) return;
      const analysisId = err && typeof err === 'object' && 'analysisId' in err && typeof (err as { analysisId?: unknown }).analysisId === 'string'
        ? (err as { analysisId: string }).analysisId
        : undefined;
      setAnalyzing(false);
      setAnalysisProgress('');
      setAnalysisJobId(null);
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
      if (analysisId) {
        const loaded = await fetchOcrAnalysis(analysisId).catch(() => null);
        if (shouldContinue() && loaded && loaded.status !== 'extracting') setAnalysis(loaded);
      }
      noteFinished(choice.jobId);
    }
  }, [noteFinished]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const ack = () => {
      const jobId = pendingAck.current;
      if (!jobId || document.visibilityState === 'hidden' || node.getClientRects().length === 0) return;
      pendingAck.current = null;
      acknowledgeJob(jobId);
    };
    const observer = new IntersectionObserver(() => ack());
    observer.observe(node);
    document.addEventListener('visibilitychange', ack);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', ack);
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('handoff')) return;
    const controller = new AbortController();
    followAbort.current = controller;
    const token = ++watchRef.current;
    const shouldContinue = () => watchRef.current === token;
    void (async () => {
      let launch: OcrLaunchTarget | null = null;
      try {
        launch = readStoredLaunch(sessionStorage.getItem(hubOpenTargetKey('ocr')));
        if (launch) sessionStorage.removeItem(hubOpenTargetKey('ocr'));
      } catch {
        launch = null;
      }
      try {
        if (launch) {
          const job = launch.jobId ? await fetchResumeJob(launch.jobId, controller.signal) : null;
          if (!shouldContinue()) return;
          await presentChoice(chooseOcrResume({ launch, job }), controller.signal, shouldContinue);
          return;
        }
        const response = await fetch(hubApiPath('/api/ocr/active'), {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as { job?: OcrResumeJob | null };
          const choice = chooseFromJob(data.job ?? null);
          if (choice.action !== 'none') {
            await presentChoice(choice, controller.signal, shouldContinue);
            return;
          }
        }
        if (!shouldContinue()) return;
        const savedId = sessionStorage.getItem('sorye.ocr.reading');
        if (!savedId) return;
        const saved = await fetchOcrAnalysis(savedId, controller.signal);
        if (!saved || !shouldContinue()) return;
        if (saved.status === 'extracting') {
          setAnalyzing(true);
          const done = await followAnalysis(saved, (next) => {
            if (shouldContinue()) setAnalysis(next);
          });
          if (!shouldContinue()) return;
          setAnalysis(done);
          setAnalyzing(false);
          return;
        }
        setAnalysis(saved);
        if (saved.vector?.gpuStartedAt) setGpuStartedAt(saved.vector.gpuStartedAt);
      } catch (err) {
        if (!shouldContinue() || stopped(err)) return;
        setAnalyzing(false);
        setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
      }
    })();
    return () => controller.abort();
  }, [presentChoice]);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<HubOpenAppDetail>).detail;
      if (!detail || detail.appId !== 'ocr') return;
      if (!detail.analysisId && !detail.jobId && !detail.outcome) return;
      try { sessionStorage.removeItem(hubOpenTargetKey('ocr')); } catch { /* already consumed */ }
      followAbort.current?.abort();
      const controller = new AbortController();
      followAbort.current = controller;
      const token = ++watchRef.current;
      const shouldContinue = () => watchRef.current === token;
      const launch: OcrLaunchTarget = {
        analysisId: detail.analysisId,
        jobId: detail.jobId,
        outcome: detail.outcome,
      };
      void (async () => {
        try {
          const job = launch.jobId ? await fetchResumeJob(launch.jobId, controller.signal) : null;
          if (!shouldContinue()) return;
          await presentChoice(chooseOcrResume({ launch, job }), controller.signal, shouldContinue);
        } catch (err) {
          if (!shouldContinue() || stopped(err)) return;
          setAnalyzing(false);
          setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
        }
      })();
    }
    window.addEventListener(HUB_OPEN_APP_EVENT, onOpen);
    return () => {
      window.removeEventListener(HUB_OPEN_APP_EVENT, onOpen);
      followAbort.current?.abort();
    };
  }, [presentChoice]);

  useEffect(() => {
    warmOcrEngine();
    return () => {
      revokePreviewUrls(pageScansRef.current);
      clearPdfCache();
    };
  }, []);

  const pdfPageCount =
    pageScans[0]?.result.source.pdfPageCount ?? scanPageCount;
  const activeScan =
    pageScans.find((scan) => scan.page === viewPage) ?? pageScans[0] ?? null;
  const result = activeScan?.result ?? null;

  const totalCellCount = useMemo(
    () => displayPages.reduce((sum, page) => sum + countFilledCells(page.layout), 0),
    [displayPages],
  );

  const totalRowCount = useMemo(
    () => displayPages.reduce((sum, page) => sum + page.layout.rows.length, 0),
    [displayPages],
  );

  const detectedCount = totalCellCount;

  const meanConfidence = useMemo(() => {
    if (pageScans.length === 0) return 0;
    const sum = pageScans.reduce((acc, scan) => acc + scan.result.meanConfidence, 0);
    return sum / pageScans.length;
  }, [pageScans]);

  const consumable = useMemo(() => ready ? {
    fileName: pageScans[0]?.result.source.fileName ?? 'document.pdf',
    pages: pageScans.map((scan) => ({
      page: scan.page,
      rows: (displayPages.find((page) => page.page === scan.page)?.layout ?? layoutFromResult(scan.result)).matrix,
    })),
  } : null, [ready, pageScans, displayPages]);

  const runScan = useCallback(async (file: File, driveFileId?: string) => {
    const jobId = ++jobRef.current;
    setError(null);
    setBusy(true);
    setProgress(0);
    setPageScans((prev) => {
      revokePreviewUrls(prev);
      return [];
    });
    setDisplayPages([]);
    setReady(false);
    setSendStatus(null);
    setAnalysis(null);
    setAnalysisError(null);
    setPreviewUrl(null);
    setViewPage(1);
    setScanPage(1);
    setScanPageCount(0);
    modalRef.current?.close();
    clearPdfCache();

    uploadedFileRef.current = file;
    driveFileIdRef.current = driveFileId ?? null;

    try {
      if (!driveFileIdRef.current) {
        const saved = await uploadToDrive(file, 'ocr', hubApiPath('/api/files'));
        driveFileIdRef.current = saved.id;
      }
      const pageCount = await getPdfPageCount(file);
      setScanPageCount(pageCount);
      const scans: PageScan[] = [];

      for (let page = 1; page <= pageCount; page += 1) {
        if (jobId !== jobRef.current) return;

        setScanPage(page);
        const prepared = await prepareFileForOcr(file, page);
        if (jobId !== jobRef.current) return;

        const url = await canvasToPreviewUrl(prepared.canvas);
        if (page === 1) setPreviewUrl(url);

        const ocr = await runOcr({
          canvas: prepared.canvas,
          binaryCanvas: prepared.binaryCanvas,
          file,
          processedWidth: prepared.width,
          processedHeight: prepared.height,
          originalBytes: prepared.originalBytes,
          pdfPage: prepared.pdfPage,
          pdfPageCount: prepared.pdfPageCount,
          textLayerWords: prepared.textLayerWords,
          textLayerRaw: prepared.textLayerRaw,
          extractMode: prepared.extractMode,
          onProgress: (pct) => {
            if (jobId !== jobRef.current) return;
            const overall =
              ((page - 1) / pageCount) * 100 + pct / pageCount;
            setProgress(Math.round(overall));
          },
        });
        if (jobId !== jobRef.current) {
          URL.revokeObjectURL(url);
          return;
        }

        scans.push({ page, result: ocr, previewUrl: url });
      }

      setPageScans(scans);
      setViewPage(1);
      if (scans[0]) setPreviewUrl(scans[0].previewUrl);

      const pages = buildDisplayPages(scans);
      if (pages.length > 0) {
        setDisplayPages(pages);
        setReady(true);
        const rows = pages.reduce((sum, page) => sum + page.layout.rows.length, 0);
        const cells = pages.reduce(
          (sum, page) => sum + countFilledCells(page.layout),
          0,
        );
        void emitWorkspaceEvent('sorye.ocr.analyzed', {
          title: `OCR finished: ${file.name}`,
          summary: `${pageCount} page(s) · ${rows} rows · ${cells} cells`,
          appId: 'ocr',
          meta: {
            pages: pageCount,
            rows,
            cells,
            fileName: file.name,
          },
        });
      }
    } catch (err) {
      if (jobId !== jobRef.current) return;
      setError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      if (jobId === jobRef.current) {
        setBusy(false);
        setProgress(0);
        setScanPage(1);
        setScanPageCount(0);
      }
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    const handoffId = new URLSearchParams(window.location.search).get('handoff');
    if (!handoffId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        setBusy(true);
        const response = await fetch(hubApiPath(`/api/handoffs?id=${encodeURIComponent(handoffId)}`), {
          credentials: 'include', signal: controller.signal,
        });
        const { handoff, error: message } = await response.json();
        if (!response.ok) throw new Error(message || 'Could not open file');
        if (handoff.targetAppId !== 'ocr' || handoff.kind !== 'workspace-file' ||
            typeof handoff.payload?.fileId !== 'string') throw new Error('Invalid OCR file handoff');
        const fileId = handoff.payload.fileId;
        const fileResponse = await fetch(hubApiPath(`/api/files/${encodeURIComponent(fileId)}`), {
          credentials: 'include', signal: controller.signal,
        });
        if (!fileResponse.ok) throw new Error('This file is no longer available in Drive');
        const blob = await fileResponse.blob();
        const disposition = fileResponse.headers.get('Content-Disposition') || '';
        const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        const file = new File([blob], encodedName ? decodeURIComponent(encodedName) : handoff.title, { type: blob.type });
        if (!isAcceptedUpload(file)) throw new Error('Only PDF documents are supported');
        if (controller.signal.aborted) return;
        await runScan(file, fileId);
        if (controller.signal.aborted) return;
        await fetch(hubApiPath('/api/handoffs'), {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: handoffId, consume: true }),
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not open file');
          setBusy(false);
        }
      }
    })();
    return () => { controller.abort(); };
  }, [runScan]);

  const processFile = useCallback(
    (file: File | null) => {
      if (!file || busy || analyzing || comparisonBusy) return;
      if (!isAcceptedUpload(file)) {
        setError('Only PDF documents are supported.');
        return;
      }
      void runScan(file);
    },
    [runScan, busy, analyzing, comparisonBusy],
  );

  function viewPdfPage(next: number) {
    if (busy || pdfPageCount <= 1) return;
    const page = Math.min(Math.max(1, next), pdfPageCount);
    const scan = pageScans.find((entry) => entry.page === page);
    if (!scan) return;
    setViewPage(page);
    setPreviewUrl(scan.previewUrl);
  }

  function showInUi() {
    if (pageScans.length === 0) return;

    const pages = buildDisplayPages(pageScans);

    if (pages.length === 0) {
      const anyText = pageScans.some((scan) => hasReadableText(scan.result));
      setError(
        anyText
          ? 'Text was detected but could not be laid out as a matrix.'
          : 'No text found in this PDF. Try a text-based or higher-quality scanned PDF.',
      );
      return;
    }

    setError(null);
    setDisplayPages(pages);
    setReady(true);
    modalRef.current?.showModal();
  }

  function exportCsv() {
    const pages =
      displayPages.length > 0 ? displayPages : buildDisplayPages(pageScans);
    if (pages.length === 0) {
      setError('Nothing to export — no layout matrix was reconstructed.');
      return;
    }

    const base =
      pageScans[0]?.result.source.fileName?.replace(/\.pdf$/i, '') ?? 'ocr';
    downloadCsv(layoutsToCsv(pages.map((p) => p.layout)), `${base}.csv`);
  }

  async function sendToProtocolio() {
    const pages =
      displayPages.length > 0 ? displayPages : buildDisplayPages(pageScans);
    if (pages.length === 0) {
      setError('Nothing to send — no layout matrix was reconstructed.');
      return;
    }

    setSending(true);
    setError(null);
    setSendStatus(null);
    try {
      if (!ready) {
        setDisplayPages(pages);
        setReady(true);
      }

      const result = await sendLayoutToProtocolio({
        layouts: pages.map((p) => p.layout),
        fileName: pageScans[0]?.result.source.fileName,
        pageCount: pages.length,
        rowCount: pages.reduce((sum, p) => sum + p.layout.rows.length, 0),
        cellCount: pages.reduce((sum, p) => sum + countFilledCells(p.layout), 0),
      });

      setSendStatus(
        result.pdf
          ? `PDF ready · ${result.pdf.filename}${result.pdf.generationTimeMs ? ` · ${result.pdf.generationTimeMs}ms` : ''} · sent to Protocolio`
          : result.eventDelivered
            ? `Sent to Protocolio · event delivered · ${result.handoff.id}`
            : `Sent to Protocolio · open Protocolio · ${result.handoff.id}`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send to Protocolio',
      );
    } finally {
      setSending(false);
    }
  }

  async function analyzeWithQwen() {
    const file = uploadedFileRef.current;
    if (!file || analyzing || comparisonBusy) return;
    followAbort.current?.abort();
    const controller = new AbortController();
    followAbort.current = controller;
    const token = ++watchRef.current;
    const shouldContinue = () => watchRef.current === token;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    setGpuStartedAt(null);
    let startedJob: string | null = null;
    try {
      const body = new FormData();
      if (!driveFileIdRef.current) throw new Error('Save this PDF to Drive before analyzing it');
      body.append('fileId', driveFileIdRef.current);
      const current = await submitAndFollowAnalysis(body, (next) => {
        if (!shouldContinue()) return;
        setAnalysis(next);
        if (next.vector?.gpuStartedAt) setGpuStartedAt(next.vector.gpuStartedAt);
        const cursor = next.vector?.cursor;
        setAnalysisProgress(cursor?.total
          ? `Qwen is reading section ${Math.min(cursor.next + 1, cursor.total)} of ${cursor.total}.`
          : 'Qwen is reading this document. A few pages usually take a minute.');
      }, (status, started) => {
        if (!shouldContinue()) return;
        if (started) setGpuStartedAt(started);
        setAnalysisProgress(status);
      }, (jobId) => {
        startedJob = jobId;
        setAnalysisJobId(jobId);
      }, gpuPref.target, shouldContinue, controller.signal);
      if (!shouldContinue()) return;
      setAnalysis(current);
      if (current.vector?.gpuStartedAt) setGpuStartedAt(current.vector.gpuStartedAt);
      noteFinished(startedJob ?? undefined);
      const summary =
        current.pattern?.summary ||
        current.error ||
        'Rows stored';
      void emitWorkspaceEvent('sorye.ocr.analyzed', {
        title: `Qwen read ${file.name}`,
        summary,
        appId: 'ocr',
        entityId: current.id,
        meta: {
          model: current.model,
          status: current.status,
          pages: current.pages.length,
        },
      });
    } catch (err) {
      if (!shouldContinue() || stopped(err)) return;
      const analysisId = err && typeof err === 'object' && 'analysisId' in err && typeof (err as { analysisId?: unknown }).analysisId === 'string'
        ? (err as { analysisId: string }).analysisId
        : undefined;
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
      if (analysisId) {
        const loaded = await fetchOcrAnalysis(analysisId).catch(() => null);
        if (shouldContinue() && loaded && loaded.status !== 'extracting') setAnalysis(loaded);
      }
      noteFinished(startedJob ?? undefined);
    } finally {
      if (shouldContinue()) {
        setAnalyzing(false);
        setAnalysisProgress('');
        setAnalysisJobId(null);
      }
    }
  }

  async function cancelQueuedAnalysis() {
    if (!analysisJobId) return;
    try {
      const response = await fetch(hubApiPath(`/api/jobs/${encodeURIComponent(analysisJobId)}`), {
        method: 'DELETE', credentials: 'include',
      });
      if (!response.ok) throw new Error('Could not cancel the analysis');
      setAnalysisProgress('Cancellation requested. Any extracted rows are retained.');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Could not cancel the analysis');
    }
  }

  async function analyzeComparisonFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter(isAcceptedUpload);
    if (pdfs.length === 0) {
      setComparisonError('Choose one or more PDF files.');
      return;
    }
    followAbort.current?.abort();
    const controller = new AbortController();
    followAbort.current = controller;
    const token = ++watchRef.current;
    const shouldContinue = () => watchRef.current === token;
    setComparisonBusy(true);
    setComparisonError(null);
    const errors: string[] = [];
    try {
      for (let index = 0; index < pdfs.length; index += 1) {
        const file = pdfs[index]!;
        setComparisonProgress(`Saving and analyzing ${index + 1} of ${pdfs.length}: ${file.name}`);
        try {
          const saved = await uploadToDrive(file, 'ocr', hubApiPath('/api/files'));
          const body = new FormData();
          body.append('fileId', saved.id);
          setGpuStartedAt(null);
          const complete = await submitAndFollowAnalysis(body, (next) => {
            if (!shouldContinue()) return;
            if (next.vector?.gpuStartedAt) setGpuStartedAt(next.vector.gpuStartedAt);
          }, (status, started) => {
            if (!shouldContinue()) return;
            if (started) setGpuStartedAt(started);
            setComparisonProgress(`Analyzing ${index + 1} of ${pdfs.length}: ${file.name} · ${status}`);
          }, undefined, gpuPref.target, shouldContinue, controller.signal);
          if (!shouldContinue()) return;
          setComparisonDocuments((previous) => [
            ...previous.filter((item) => item.analysis.id !== complete.id),
            {
              analysis: {
                id: complete.id,
                fileName: complete.fileName,
                status: complete.status,
                pattern: complete.pattern,
                error: complete.error,
              },
              selected: true,
            },
          ]);
        } catch (err) {
          if (!shouldContinue() || stopped(err)) return;
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Analysis failed'}`);
        }
      }
      if (errors.length > 0) setComparisonError(errors.join(' · '));
    } finally {
      setComparisonBusy(false);
      setComparisonProgress('');
      if (compareFilesRef.current) compareFilesRef.current.value = '';
    }
  }

  function toggleComparisonDocument(analysisId: string) {
    setComparisonDocuments((previous) => previous.map((item) =>
      item.analysis.id === analysisId ? { ...item, selected: !item.selected } : item,
    ));
  }

  function closePreview() {
    modalRef.current?.close();
  }

  function onModalClick(event: React.MouseEvent<HTMLDialogElement>) {
    const dialog = modalRef.current;
    if (!dialog) return;
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inContent =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!inContent) dialog.close();
  }

  const scanningMultiPage = pdfPageCount > 1;

  return (
    <div className="ocr-app" ref={rootRef}>
      <ol className="ocr-workflow" role="list" aria-label="Document workflow">
        <li aria-current={!ready ? 'step' : undefined}><span>01</span><div><strong>Upload</strong><small>Choose a PDF</small></div></li>
        <li aria-current={ready && !analysis ? 'step' : undefined}><span>02</span><div><strong>Review</strong><small>Check extracted tables</small></div></li>
        <li aria-current={analysis ? 'step' : undefined}><span>03</span><div><strong>Understand</strong><small>Read, inspect, export</small></div></li>
      </ol>

      <section className="ocr-upload" aria-label="Upload">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => void processFile(e.target.files?.[0] ?? null)}
        />

        <div
          className="ocr-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void processFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <div className="ocr-upload-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></svg>
          </div>
          <h2>{result?.source.fileName || 'Start with a document'}</h2>
          <p>Drop your PDF here, or browse your files. Uploads are saved in Drive / OCR.</p>
          <a href={hubApiPath('/apps/files')}>Browse Drive</a>
          <div className="ocr-actions">
            <Button variant="primary" size="lg" disabled={busy || analyzing || comparisonBusy} onClick={() => fileRef.current?.click()}>
              {ready ? 'Choose another PDF' : 'Upload PDF'}
            </Button>
          </div>
        </div>

        {busy ? (
          <div className="ocr-progress" role="status">
            <div className="ocr-progress-bar" style={{ width: `${progress}%` }} />
            <span>
              {scanningMultiPage
                ? `Reading page ${scanPage} of ${pdfPageCount}… ${progress}%`
                : `Reading PDF… ${progress}%`}
            </span>
          </div>
        ) : null}

        {pdfPageCount > 1 && pageScans.length > 0 && !busy ? (
          <div className="ocr-pdf-pages">
            <span>
              Viewing page {viewPage} of {pdfPageCount}
              {pageScans.length === pdfPageCount
                ? ' · all pages read'
                : ''}
            </span>
            <div className="ocr-actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={viewPage <= 1}
                onClick={() => viewPdfPage(viewPage - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={viewPage >= pdfPageCount}
                onClick={() => viewPdfPage(viewPage + 1)}
              >
                <TranslatedText message="next" />
              </button>
            </div>
          </div>
        ) : null}

        {pageScans.length > 0 && !busy ? (
          <div className="ocr-create-row">
            <p>
              {detectedCount > 0
                ? `${totalRowCount || detectedCount} row${(totalRowCount || detectedCount) === 1 ? '' : 's'} · ${detectedCount} cell${detectedCount === 1 ? '' : 's'}`
                : 'Text read from document'}
              {scanningMultiPage
                ? ` across ${pageScans.length} page${pageScans.length === 1 ? '' : 's'}`
                : ''}
              {result?.rawText
                ? ` · ${result.rawText.split(/\s+/).filter(Boolean).length} words on this page`
                : ''}
            </p>
            <div className="ocr-actions">
              <button
                type="button"
                className="btn-primary btn-create-table"
                onClick={showInUi}
              >
                Show matrix
              </button>
              <label className="ocr-gpu-select" aria-label="LLM GPU target">
                <select
                  value={gpuPref.target}
                  disabled={analyzing || comparisonBusy}
                  onChange={(e) => switchOcrGpuTarget(e.target.value as LlmExecutionTarget)}
                >
                  <option value="hub-server">Hub Server GPU (Qwen3-8B)</option>
                  <option value="client-webgpu">
                    My GPU (WebGPU{webGpuInfo?.available ? ` · ${webGpuInfo.vendor}` : ''})
                  </option>
                </select>
              </label>
              <Button variant="primary" loading={analyzing} disabled={analyzing || comparisonBusy} onClick={() => void analyzeWithQwen()}>
                {analyzing
                  ? 'Reading document…'
                  : gpuPref.target === 'client-webgpu'
                    ? 'Analyze with Qwen (My WebGPU)'
                    : 'Analyze with Qwen'}
              </Button>
              <button
                type="button"
                className="btn-ghost"
                disabled={sending}
                onClick={() => void sendToProtocolio()}
              >
                {sending ? 'Sending…' : 'Send to Protocolio'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={exportCsv}
              >
                Export as CSV
              </button>
            </div>
          </div>
        ) : null}

        {analyzing ? (
          <div className="ocr-send-status">
            <span role="status">{analysisProgress || (analysis?.status === 'extracting' && analysis.vector?.cursor
              ? `Qwen is reading section ${Math.min(analysis.vector.cursor.next + 1, analysis.vector.cursor.total)} of ${analysis.vector.cursor.total}.`
              : 'Qwen is reading this document. A few pages usually take a minute.')}</span>
            {gpuStartedAt && analysis?.status !== 'ready' && analysis?.status !== 'rows_only' ? (
              <GpuClock startedAt={gpuStartedAt} live />
            ) : null}
            {analysisJobId ? <button type="button" className="btn-ghost" onClick={() => void cancelQueuedAnalysis()}>Cancel analysis</button> : null}
          </div>
        ) : null}

        {sendStatus ? <p className="ocr-send-status">{sendStatus}</p> : null}

        {error ? <p className="ocr-error">{error}</p> : null}
      </section>

      <section className="ocr-compare-upload" aria-labelledby="ocr-compare-upload-title">
        <div>
          <h2 id="ocr-compare-upload-title">Compare multiple PDFs</h2>
          <p>Upload related schedules or revisions. Qwen identifies row address IDs, then matching rows are aligned into one table.</p>
        </div>
        <input
          ref={compareFilesRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files?.length) void analyzeComparisonFiles(files);
          }}
        />
        <Button
          variant="primary"
          disabled={!comparisonRestored || comparisonBusy || busy || analyzing}
          loading={comparisonBusy}
          onClick={() => compareFilesRef.current?.click()}
        >
          {comparisonBusy ? 'Analyzing PDFs…' : 'Upload PDFs to compare'}
        </Button>
        {comparisonProgress ? (
          <p>
            <span role="status">{comparisonProgress}</span>
            {comparisonBusy && gpuStartedAt ? <GpuClock startedAt={gpuStartedAt} live /> : null}
          </p>
        ) : null}
        {comparisonError ? <p className="ocr-error" role="alert">{comparisonError}</p> : null}
      </section>

      <CombinedReading
        documents={comparisonDocuments}
        onToggle={toggleComparisonDocument}
      />

      {pageScans.length > 0 ? <div className="ocr-layout">
        <aside className="ocr-preview-panel">
          <h2>Source</h2>
          {previewUrl ? (
            <img src={previewUrl} alt="Document preview" className="ocr-preview" />
          ) : (
            <p className="ocr-muted">No document yet.</p>
          )}
          {result ? (
            <ul className="ocr-meta">
              <li>
                {result.source.processedWidth}×{result.source.processedHeight} ·{' '}
                {formatBytes(result.source.originalBytes)}
                {pdfPageCount > 1
                  ? ` · page ${viewPage}/${pdfPageCount}`
                  : ''}
              </li>
              <li>
                {detectedCount} cell{detectedCount === 1 ? '' : 's'}
                {pdfPageCount > 1 ? ' total' : ''} ·{' '}
                {Math.round(meanConfidence)}% confidence
                {result?.source.extractMode === 'pdf-text' ||
                Math.round(meanConfidence) === 100
                  ? ' · PDF text layer'
                  : ' · OCR'}
              </li>
            </ul>
          ) : null}
        </aside>

        <section className="ocr-table-panel" aria-label="Layout matrix">
          <div className="ocr-table-head">
            <h2>Layout matrix</h2>
            <span className="ocr-muted">{displayPages.length} pages · {totalRowCount} rows</span>
          </div>

          {pageScans.length === 0 ? (
            <p className="ocr-muted">
              Upload a PDF first. When reading finishes, use Show matrix.
            </p>
          ) : !ready ? (
            <p className="ocr-muted">
              Content was read from the document. Press <strong>Show matrix</strong>{' '}
              to view the evaluated layout with font size and weight.
            </p>
          ) : (
            <DocumentPagesPreview pages={displayPages} />
          )}
        </section>
      </div> : null}

      {analysis && analysis.status !== 'extracting' ? (
        <ReadingView key={analysis.id} analysis={analysis} />
      ) : null}
      {analysis?.status === 'extracting' ? (
        <p className="ocr-send-status" role="status">
          {analysis.vector?.cursor
            ? `Saved. Qwen is on section ${Math.min(analysis.vector.cursor.next + 1, analysis.vector.cursor.total)} of ${analysis.vector.cursor.total}.`
            : 'Saved. Qwen is still reading this document.'}
        </p>
      ) : null}

      {analysisError ? <p className="ocr-error">{analysisError}</p> : null}

      {consumable ? (
        <section className="ocr-extraction-export">
          <JsonDocument value={consumable} fileName={consumable.fileName.replace(/\.pdf$/i, '') + '-browser-matrix'} label="Browser matrix JSON" />
        </section>
      ) : null}

      <LibraryPanel />

      <dialog
        ref={modalRef}
        id="ocr-table-modal"
        className="ocr-modal"
        aria-labelledby="ocr-modal-title"
        closedby="any"
        onClick={onModalClick}
      >
        <div className="ocr-modal-chrome">
          <div className="ocr-modal-head">
            <div>
              <h2 id="ocr-modal-title">Layout matrix</h2>
              <p className="ocr-modal-sub">
                {totalRowCount} row{totalRowCount === 1 ? '' : 's'} ·{' '}
                {totalCellCount} cell{totalCellCount === 1 ? '' : 's'}
                {result?.source.fileName ? ` · ${result.source.fileName}` : ''}
                {pdfPageCount > 1
                  ? ` · ${displayPages.length} page${displayPages.length === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={closePreview}>
              <TranslatedText message="close" />
            </button>
          </div>
        </div>
        <div className="ocr-page-preview" role="document">
          <DocumentPagesPreview pages={displayPages} className="ocr-page-table" />
        </div>
      </dialog>
    </div>
  );
}
