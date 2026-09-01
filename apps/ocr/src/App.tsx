import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildOcrObject,
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
import { downloadCsv, layoutsToCsv } from './export-csv';
import './styles.css';

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
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  useEffect(() => {
    pageScansRef.current = pageScans;
  }, [pageScans]);

  useEffect(() => {
    warmOcrEngine();
    return () => {
      revokePreviewUrls(pageScansRef.current);
      clearPdfCache();
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
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

  const consumable = useMemo(() => {
    if (!ready || pageScans.length === 0) return null;

    const pages = pageScans.map((scan) => {
      const layout =
        displayPages.find((page) => page.page === scan.page)?.layout ??
        layoutFromResult(scan.result);
      return {
        page: scan.page,
        meanConfidence: scan.result.meanConfidence,
        rawText: scan.result.rawText,
        layout,
        matrix: layout.matrix,
        rows: layout.rows.length,
        cols: layout.cols,
        object: buildOcrObject(layout.matrix),
      };
    });

    if (pages.length === 1) {
      const scan = pageScans[0]!;
      const page = pages[0]!;
      return {
        id: scan.result.id,
        createdAt: scan.result.createdAt,
        source: scan.result.source,
        meanConfidence: scan.result.meanConfidence,
        rawText: scan.result.rawText,
        layout: page.layout,
        matrix: page.matrix,
        rows: page.rows,
        cols: page.cols,
        object: page.object,
      };
    }

    return {
      id: pageScans[0]!.result.id,
      createdAt: pageScans[0]!.result.createdAt,
      source: {
        ...pageScans[0]!.result.source,
        pdfPage: undefined,
      },
      meanConfidence,
      pageCount: pages.length,
      pages,
      layout: {
        rows: pages.flatMap((p) => p.layout.rows),
        cols: Math.max(0, ...pages.map((p) => p.layout.cols)),
        columnWidths: pages[0]?.layout.columnWidths ?? [],
        medianFontSize: pages[0]?.layout.medianFontSize ?? 12,
        matrix: pages.flatMap((p) => p.layout.matrix),
      },
    };
  }, [ready, pageScans, displayPages, meanConfidence]);

  const runScan = useCallback(async (file: File) => {
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
    setCopied(false);
    setSendStatus(null);
    setPreviewUrl(null);
    setViewPage(1);
    setScanPage(1);
    setScanPageCount(0);
    modalRef.current?.close();
    clearPdfCache();

    uploadedFileRef.current = file;

    try {
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

  const processFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!isAcceptedUpload(file)) {
        setError('Only PDF documents are supported.');
        return;
      }
      void runScan(file);
    },
    [runScan],
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

  async function copyJson() {
    if (!consumable) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(consumable, null, 2));
      setCopied(true);
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy JSON');
    }
  }

  function downloadJson() {
    if (!consumable) return;
    const blob = new Blob([JSON.stringify(consumable, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pageScans[0]?.result.id ?? 'ocr'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
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
          <h1>OCR</h1>
          <p>
            Upload a PDF document (English &amp; German). Text-based PDFs are
            read from the file itself; scanned PDFs use high-DPI OCR. Lines are
            differentiated by size and weight, then shown as an evaluated layout
            matrix.
          </p>
        </div>
        <span className="ocr-badge">PDF only · EN + DE</span>
      </header>

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
          <p>Drop a PDF here, or pick a file</p>
          <div className="ocr-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Upload PDF
            </button>
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

        {sendStatus ? <p className="ocr-send-status">{sendStatus}</p> : null}

        {error ? <p className="ocr-error">{error}</p> : null}
      </section>

      <div className="ocr-layout">
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
            {ready ? (
              <div className="ocr-actions">
                <button type="button" className="btn-ghost" onClick={showInUi}>
                  Show matrix
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={sending}
                  onClick={() => void sendToProtocolio()}
                >
                  {sending ? 'Sending…' : 'Send to Protocolio'}
                </button>
                <button type="button" className="btn-ghost" onClick={exportCsv}>
                  Export as CSV
                </button>
                <button type="button" className="btn-ghost" onClick={() => void copyJson()}>
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
                <button type="button" className="btn-ghost" onClick={downloadJson}>
                  Download
                </button>
              </div>
            ) : null}
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
      </div>

      {consumable ? (
        <section className="ocr-json-panel" aria-label="Consumable object">
          <div className="ocr-table-head">
            <h2>Consumable object</h2>
            {totalCellCount > 0 ? (
              <span className="ocr-muted">
                {totalRowCount} row{totalRowCount === 1 ? '' : 's'} ·{' '}
                {totalCellCount} cell{totalCellCount === 1 ? '' : 's'}
                {displayPages.length > 1
                  ? ` · ${displayPages.length} pages`
                  : ''}
              </span>
            ) : null}
          </div>
          <pre>
            <code>{JSON.stringify(consumable, null, 2)}</code>
          </pre>
        </section>
      ) : null}

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
