import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import { Button } from '@sorye/sdk/react';
import { uploadToDrive } from '@sorye/sdk/files';
import { JsonDocument } from '@sorye/sdk/react/document-reading';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type OcrAnalysis,
  type OcrMatrix,
  type OcrPageLayout,
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
import { ReadingView } from './reading-view';
import { LibraryPanel } from './library-panel';
import { downloadCsv, layoutsToCsv } from './export-csv';
import './styles.css';

async function followAnalysis(
  start: OcrAnalysis,
  onProgress: (analysis: OcrAnalysis) => void,
): Promise<OcrAnalysis> {
  let current = start;
  onProgress(current);
  try {
    sessionStorage.setItem('sorye.ocr.reading', current.id);
  } catch {
    // The hub frame can block storage. The reading still continues in this tab.
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  useEffect(() => {
    pageScansRef.current = pageScans;
  }, [pageScans]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('handoff')) return;
    const savedId = sessionStorage.getItem('sorye.ocr.reading');
    if (!savedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(hubApiPath(`/api/ocr/analyses/${savedId}`), {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { analysis?: OcrAnalysis };
        if (cancelled || !data.analysis || data.analysis.status !== 'extracting') return;
        setAnalyzing(true);
        await followAnalysis(data.analysis, (next) => {
          if (!cancelled) setAnalysis(next);
        });
      } catch (err) {
        if (!cancelled) {
          setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
        }
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      text: scan.result.rawText,
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
      if (!file || busy || analyzing) return;
      if (!isAcceptedUpload(file)) {
        setError('Only PDF documents are supported.');
        return;
      }
      void runScan(file);
    },
    [runScan, busy, analyzing],
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
    if (!file || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const body = new FormData();
      if (!driveFileIdRef.current) throw new Error('Save this PDF to Drive before analyzing it');
      body.append('fileId', driveFileIdRef.current);
      const res = await fetch(hubApiPath('/api/ocr/analyze'), {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        analysis?: OcrAnalysis;
      };
      if (!res.ok || !data.analysis) {
        throw new Error(data.error || `Analysis failed (${res.status})`);
      }
      const current = await followAnalysis(data.analysis, setAnalysis);
      const summary =
        current.pattern?.summary ||
        current.error ||
        'Rows stored';
      void emitWorkspaceEvent('sorye.ocr.analyzed', {
        title: `Qwen read ${file.name}`,
        summary,
        appId: 'ocr',
        entityId: data.analysis.id,
        meta: {
          model: current.model,
          status: current.status,
          pages: current.pages.length,
        },
      });
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
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
    <div className="ocr-app">
      <header className="ocr-header">
        <div>
          <p className="ocr-eyebrow">DOCUMENT WORKSPACE</p>
          <h1>Turn documents into useful data</h1>
          <p>Extract your PDF, review its tables, and explore an AI-assisted reading with a complete transcript.</p>
        </div>
        <span className="ocr-badge">PDF only · EN + DE</span>
      </header>

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
            <Button variant="primary" size="lg" disabled={busy || analyzing} onClick={() => fileRef.current?.click()}>
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
                Next
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
              <Button variant="primary" loading={analyzing} disabled={analyzing} onClick={() => void analyzeWithQwen()}>
                {analyzing ? 'Reading document…' : 'Analyze with Qwen'}
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
          <p className="ocr-send-status" role="status">
            {analysis?.status === 'extracting' && analysis.vector?.cursor
              ? `Qwen is reading section ${Math.min(analysis.vector.cursor.next + 1, analysis.vector.cursor.total)} of ${analysis.vector.cursor.total}.`
              : 'Qwen is reading this document. A few pages usually take a minute.'}
          </p>
        ) : null}

        {sendStatus ? <p className="ocr-send-status">{sendStatus}</p> : null}

        {error ? <p className="ocr-error">{error}</p> : null}
      </section>

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
          <JsonDocument value={consumable} fileName={consumable.fileName.replace(/\.pdf$/i, '') + '-extracted'} label="extracted JSON" />
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
              Close
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
