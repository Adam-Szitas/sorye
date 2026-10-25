# OCR PDF audit — 2026-10-25

## Executed prompt

Audit the OCR micro-frontend and its PDF-to-Qwen storage pipeline. Verify extraction completeness, large-document handling, preservation and highlighting of mathematical expressions, storage fidelity, and data security. Check whether one ordered vector contains all PDF lines and whether summarization uses both the original PDF and persisted extraction. Fix bounded defects supported by the code, test them, and distinguish verified behavior from architectural gaps. Interpret “vector” as an ordered array of lines, not a numerical embedding, which cannot preserve the original lines.

## Verdict

The current OCR does **not yet meet the complete requested workflow**. The fixes below improve existing extraction but do not establish reliable scanned-PDF recognition, secure document archival, or full-document rereading. No existing user documents or production records were accessed or changed for this audit.

## Findings and remaining work

| Requirement | Evidence and current status |
| --- | --- |
| Read every page, including scans | Browser `apps/ocr/src/App.tsx` processes the selected page. Its Tesseract output is not sent to the Qwen endpoint. `apps/hub/lib/ocr/read-pdf.ts` reads the native text layer and substitutes image markers; it performs no server OCR. Image-only pages now produce `rows_only` and an explicit warning. Mixed text/image pages can still omit text inside images without a warning. A unified all-page OCR fallback is needed. |
| Larger PDFs | Limits are 64 MiB, 500 pages, and 16,000,000 bytes for transcript plus pattern. Model work runs in timed batches and continues from a stored cursor, so one request does not have to finish hundreds of pages. Upload parsing still buffers the file before extraction. |
| Fewest missing lines | Long source rows previously lost their middle after 20,000 characters; that truncation is removed. Page/row input is now split into UTF-8-byte-bounded model requests, preserving source rows. Layout reconstruction still uses heuristics: columns are merged by visual row, some nearby numeric lines are inferred as fractions, and whitespace becomes underscores. Rotated text, complex equations, unusual fonts and multi-column reading order need a representative document corpus. |
| Math clearly retained | Detected expressions use `[MATH]...[/MATH]`. All detected math/image annotations are now derived from stored source rows, without the former 100-entry cap or invented model spans. Math segments are sorted by position before grouping. This does not guarantee detection or accurate reconstruction of every equation; scanned equations need math-capable recognition and validation. |
| One vector for the whole PDF | `OcrAnalysis.lines` is the ordered document vector (`pages` flattened). `vector` (`version: 1`) stores `pageStarts`, `lineCount`, and a per-page completeness note. Line text stays in `pages` so it is not stored twice. Existing rows without `vector` rebuild it on read. |
| Correct persistence | JSON file round-trip tests preserve long rows, Unicode and math after reopening. JSON/Postgres store implementations are workspace-scoped and write page arrays and pattern JSON. Live Postgres and workspace-database writes were not tested. JSON storage is a single-process development store: its load helper catches all read/parse failures as empty storage, and its Windows fallback writes directly to the target. These are durability gaps. |
| Save before summarizing | `POST /api/ocr/analyze` writes the row vector with status `extracting` before calling Qwen, then updates that same row with the pattern. A killed request can leave `extracting` with the lines intact. The summary is still inline in the request: sequential model calls can exceed the route duration, and there is no resumable job yet. |
| Reread original plus saved extraction | Original PDF bytes are discarded after parsing. Qwen receives extracted strings in the same request, not a reread from storage. There is no original-versus-transcript comparison. Store an authorized original with a content hash and extraction version, then verify the stored extraction against it before summarization. Qwen3 8B is text-input; visual comparison needs an OCR/vision component. |
| Complete summary | Chunk summaries are concatenated and clipped to 2,000 characters; records/patterns are also capped. The loop stops after the first failed chunk. A hierarchical summary with coverage metadata, retained chunk results, retries, and citations is needed. A summary is not a lossless replacement for stored lines. |
| Retention | Both stores automatically discard analyses beyond 40 per workspace. The list endpoint returns only the latest 20. These are not archival guarantees; retention and pagination need an explicit product policy. |
| Data security | Authentication and workspace membership checks exist. No application-level encryption protects OCR rows/patterns in JSON or Postgres. Infrastructure encryption, backup encryption, access controls, and TLS were not verified. The multipart POST has no dedicated CSRF/origin validation. Rate limits do not isolate CPU/memory use or provide a durable job concurrency limit. |
| Data exposure | Successful OCR responses now have `private, no-store`; Ollama redirects are rejected; model error bodies and JSON parse errors are no longer logged. The prompt treats document instructions as untrusted, but this is not a guarantee against prompt injection. `App.tsx` emits filenames and summaries in workspace events, which configured Relay routes can forward. Review that propagation before using confidential documents. |

## Implemented changes

- Preserve full extracted rows; reject oversized transcripts explicitly before inference rather than silently truncating them.
- Preserve all detected source math and image annotations and order math runs spatially.
- Split dense pages and long Unicode rows into model requests of at most 8,000 UTF-8 bytes, retaining page and row references. Set Ollama `num_ctx` explicitly to 16,384. This is a conservative input bound, not tokenizer-based verification; larger context can require more memory.
- Identify image-only pages as incomplete, enforce the page limit before page extraction, and release per-page PDF resources after extraction.
- Validate the complete `%PDF-` signature and tighten logging, redirect handling, and response caching.

## Validation

`node --test apps/hub/lib/ocr/ocr.test.cjs`: 11 passing tests covering real PDF.js extraction, page order and math, all pages of a synthetic 40-page PDF, rejection of 41 pages, long-row fidelity, Unicode chunk reconstruction, row references, more than 100 annotations, failed-model fallback, image-only warnings, and JSON persistence after reopening.

`node_modules/.bin/tsc --noEmit -p apps/hub`: passed.

The model tests use mocks. No live Ollama inference, authenticated browser flow, deployed storage integration, real scanned-document accuracy evaluation, or security penetration test was performed. Synthetic fixtures establish regressions, not an accuracy percentage for arbitrary PDFs.

## Model references

- [Ollama Qwen3 model catalog](https://ollama.com/library/qwen3): Qwen3 8B accepts text input.
- [Ollama API specification](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml): `num_ctx` sets the context length; `num_predict` limits generation.

## Proposed completion sequence

1. Done: versioned document-wide line vector (`lines` + `vector.pageStarts` / per-page notes) is persisted before inference, then updated with the pattern. Still open: a resumable job so a timeout does not leave the row on `extracting`.
2. Add sequential all-page native-text/OCR extraction and math recognition, retaining original source evidence without overwriting it with model guesses.
3. Introduce resumable background processing and chunk coverage/retry tracking; synthesize a cited summary across all chunks.
4. Add protected original-PDF storage, content hashes, encryption/key management, controlled retention/deletion and backups; validate access boundaries and prevent unintended event forwarding.
5. Compare the stored vector against the retained original with an appropriate OCR/vision stage; evaluate on large, scanned, multilingual, multi-column and mathematical PDFs.
