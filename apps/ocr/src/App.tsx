import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildOcrObject, type OcrDocumentItem, type OcrMatrix } from '@sorye/types';

import { DocumentItemsPreview } from './item-tables';

import { itemsHaveContent, parseDocumentItems } from './parse-document';

import { prepareImageForOcr } from './prepare-image';

import { runOcr, textToMatrix, warmOcrEngine } from './ocr-engine';

import './styles.css';



function formatBytes(n: number): string {

  if (n < 1024) return `${n} B`;

  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;

  return `${(n / (1024 * 1024)).toFixed(2)} MB`;

}



export default function App() {

  const fileRef = useRef<HTMLInputElement>(null);

  const cameraRef = useRef<HTMLInputElement>(null);

  const previewUrlRef = useRef<string | null>(null);

  const modalRef = useRef<HTMLDialogElement>(null);

  const jobRef = useRef(0);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const [progress, setProgress] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<OcrMatrix | null>(null);

  const [items, setItems] = useState<OcrDocumentItem[]>([]);

  const [ready, setReady] = useState(false);

  const [copied, setCopied] = useState(false);



  useEffect(() => {

    warmOcrEngine();

  }, []);



  const consumable = useMemo(() => {

    if (!result || !ready) return null;

    return {

      id: result.id,

      createdAt: result.createdAt,

      source: result.source,

      meanConfidence: result.meanConfidence,

      rawText: result.rawText,

      items,

      matrix: result.matrix,

      rows: result.rows,

      cols: result.cols,

      object: buildOcrObject(result.matrix),

    };

  }, [result, items, ready]);



  const processFile = useCallback(async (file: File | null) => {

    if (!file) return;

    const jobId = ++jobRef.current;

    setError(null);

    setBusy(true);

    setProgress(0);

    setResult(null);

    setItems([]);

    setReady(false);

    setCopied(false);



    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);

    const url = URL.createObjectURL(file);

    previewUrlRef.current = url;

    setPreviewUrl(url);



    try {

      const prepared = await prepareImageForOcr(file);

      if (jobId !== jobRef.current) return;



      const ocr = await runOcr({

        canvas: prepared.canvas,

        file,

        processedWidth: prepared.width,

        processedHeight: prepared.height,

        originalBytes: prepared.originalBytes,

        onProgress: (pct) => {

          if (jobId === jobRef.current) setProgress(pct);

        },

      });

      if (jobId !== jobRef.current) return;

      setResult(ocr);

      setItems(ocr.items);

    } catch (err) {

      if (jobId !== jobRef.current) return;

      setError(err instanceof Error ? err.message : 'OCR failed');

    } finally {

      if (jobId === jobRef.current) {

        setBusy(false);

        setProgress(0);

      }

      if (fileRef.current) fileRef.current.value = '';

      if (cameraRef.current) cameraRef.current.value = '';

    }

  }, []);



  function buildItemsFromResult(): OcrDocumentItem[] {

    if (!result) return [];

    if (itemsHaveContent(result.items)) return result.items;



    let matrix = result.matrix;

    if (!matrix.some((row) => row.some((c) => c.trim())) && result.rawText) {

      matrix = textToMatrix(result.rawText);

    }



    return parseDocumentItems([], matrix);

  }



  function showInUi() {

    if (!result) return;

    const parsed = buildItemsFromResult();

    if (!itemsHaveContent(parsed)) {

      setError('Could not reconstruct items from this photo.');

      return;

    }

    setError(null);

    setItems(parsed);

    setReady(true);

    modalRef.current?.showModal();

  }



  async function copyJson() {

    if (!consumable) return;

    try {

      await navigator.clipboard.writeText(JSON.stringify(consumable, null, 2));

      setCopied(true);

      window.setTimeout(() => setCopied(false), 1600);

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

    a.download = `${result?.id ?? 'ocr'}.json`;

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



  const detectedCount = result?.items.length ?? 0;



  return (

    <div className="ocr-app">

      <header className="ocr-header">

        <div>

          <h1>OCR</h1>

          <p>

            Upload a photo with one or more items. Each item becomes its own

            table with a header, note, and amounts row.

          </p>

        </div>

        <span className="ocr-badge">Local · cached worker</span>

      </header>



      <section className="ocr-upload" aria-label="Upload">

        <input

          ref={fileRef}

          type="file"

          accept="image/*"

          hidden

          onChange={(e) => void processFile(e.target.files?.[0] ?? null)}

        />

        <input

          ref={cameraRef}

          type="file"

          accept="image/*"

          capture="environment"

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

          <p>Drop a photo here, or pick one</p>

          <div className="ocr-actions">

            <button

              type="button"

              className="btn-primary"

              disabled={busy}

              onClick={() => fileRef.current?.click()}

            >

              Upload image

            </button>

            <button

              type="button"

              className="btn-ghost"

              disabled={busy}

              onClick={() => cameraRef.current?.click()}

            >

              Use camera

            </button>

          </div>

        </div>



        {busy ? (

          <div className="ocr-progress" role="status">

            <div className="ocr-progress-bar" style={{ width: `${progress}%` }} />

            <span>Reading text… {progress}%</span>

          </div>

        ) : null}



        {result && !busy ? (

          <div className="ocr-create-row">

            <p>

              {detectedCount > 0

                ? `${detectedCount} item${detectedCount === 1 ? '' : 's'} detected`

                : 'Text read from photo'}

              {result.rawText

                ? ` · ${result.rawText.split(/\s+/).filter(Boolean).length} words`

                : ''}

            </p>

            <button

              type="button"

              className="btn-primary btn-create-table"

              onClick={showInUi}

            >

              Show in UI

            </button>

          </div>

        ) : null}



        {error ? <p className="ocr-error">{error}</p> : null}

      </section>



      <div className="ocr-layout">

        <aside className="ocr-preview-panel">

          <h2>Source</h2>

          {previewUrl ? (

            <img src={previewUrl} alt="Upload preview" className="ocr-preview" />

          ) : (

            <p className="ocr-muted">No image yet.</p>

          )}

          {result ? (

            <ul className="ocr-meta">

              <li>

                {result.source.processedWidth}×{result.source.processedHeight} ·{' '}

                {formatBytes(result.source.originalBytes)}

              </li>

              <li>

                {detectedCount} item{detectedCount === 1 ? '' : 's'} ·{' '}

                {Math.round(result.meanConfidence)}% confidence

              </li>

            </ul>

          ) : null}

        </aside>



        <section className="ocr-table-panel" aria-label="Extracted items">

          <div className="ocr-table-head">

            <h2>Extracted items</h2>

            {ready ? (

              <div className="ocr-actions">

                <button type="button" className="btn-ghost" onClick={showInUi}>

                  Show in UI

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



          {!result ? (

            <p className="ocr-muted">

              Upload a photo first. When reading finishes, use Show in UI.

            </p>

          ) : !ready ? (

            <p className="ocr-muted">

              Content was read from the photo. Press <strong>Show in UI</strong>{' '}

              to recreate each item as a table (header, note, amounts).

            </p>

          ) : (

            <DocumentItemsPreview items={items} />

          )}

        </section>

      </div>



      {consumable ? (

        <section className="ocr-json-panel" aria-label="Consumable object">

          <div className="ocr-table-head">

            <h2>Consumable object</h2>

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

              <h2 id="ocr-modal-title">Extracted content</h2>

              <p className="ocr-modal-sub">

                {items.length} item{items.length === 1 ? '' : 's'} recreated from

                the photo

                {result?.source.fileName ? ` · ${result.source.fileName}` : ''}

              </p>

            </div>

            <button type="button" className="btn-ghost" onClick={closePreview}>

              Close

            </button>

          </div>

        </div>

        <div className="ocr-page-preview" role="document">

          <DocumentItemsPreview items={items} className="ocr-page-table" />

        </div>

      </dialog>

    </div>

  );

}


