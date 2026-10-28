# OCR security and stability test plan

This runbook covers PDF upload, PDF.js extraction, matrix recognition, multi-PDF comparison, workspace storage, and local Qwen execution. Run the fast checks on every change; run the hardware checks on the target GPU host before release.

## 1. Fast checks

From the repository root:

```powershell
node --test apps/hub/lib/ocr/ocr.test.cjs
pnpm --filter @sorye/ocr exec tsc --noEmit
pnpm --filter @sorye/hub exec tsc --noEmit
```

Add unit cases for PDF header and malformed input, encrypted files, page-count and decoded-size boundaries, multi-page last-column retention, row address normalization, duplicate IDs, matrix row ordering, partial model JSON, unclear findings, and exports that never include the source transcript. Include ID equivalents such as `01.11.05 A`, `01.11.05A`, `1.11.05A`, and `01.11.5A`; assert that they group together while distinct IDs stay separate.

## 2. API security checks

Use an isolated test workspace and mocked model endpoint. Verify:

- Unauthenticated upload, continuation, list, read, and update requests return 401.
- A user in another workspace cannot read, continue, update, compare, or download an analysis or source PDF by guessing its ID.
- Upload accepts a real PDF signature only; MIME type and filename are not trusted. Reject malformed, oversized, and over-page-limit PDFs with bounded error responses.
- Reject a declared request body above the upload cap before parsing multipart data. Configure the reverse proxy/platform body limit too, because chunked requests may omit `Content-Length`.
- LLM URLs reject non-local or otherwise unsafe destinations, credentials, redirects, and unexpected schemes. A test server must not be able to redirect requests to another host.
- Model output is capped before JSON parsing; malformed and oversized responses retain extracted rows and produce a bounded error.
- User-controlled PDF text is treated as data. The model output schema is normalized and capped; arbitrary properties, transcript echoes, and unsupported `records`/`fields` are discarded.
- Rate limiting and admission return 429 with `Retry-After` where appropriate; no concurrent request bypasses the single-process OCR slot.

## 3. Reliability and recovery checks

Exercise one normal PDF, multiple selected PDFs, cancel/timeout, model unavailable, malformed model output, and a process restart during analysis. Confirm that source files and extracted rows remain available when the model fails, continuation cursors advance only over completed slices, retries do not duplicate rows/findings, and the model unload is attempted on every terminal request path. Reopening an app should restore its last saved selection and comparison state.

Keep the live test artifacts synthetic and in a disposable workspace. The local scripts can write persistent analysis data; inspect their behavior and use an isolated database before running them.

## 4. GPU memory acceptance

Run only on the intended NVIDIA host with Docker/model service available. Capture `nvidia-smi` before, during, and after each run. Test cold and warm model starts with a representative two-page PDF and the 12-page/240-row fixture, then repeat each run at least five times.

Acceptance criteria:

- The default guard fails closed when GPU telemetry cannot be read, free memory is below 1536 MiB, or temperature reaches 85 C. Only set `OCR_GPU_GUARD=false` for an explicitly approved non-NVIDIA test environment.
- Headroom is checked before every model inference. Under pressure, OCR returns retained extracted rows with a clear `rows_only` result and does not keep retrying the model call.
- The configured local server runs one model and one parallel sequence. No waiting queue grows under contention; a competing Hub request receives 429.
- VRAM returns to the expected idle range after Ollama unload and remains bounded over repeated runs. Record the model, driver, GPU, free/used VRAM peak, temperature peak, PDF size/page count, duration, and result status.
- Repeat with the PDF near the configured size limit and with a deliberately stalled model service. Confirm the Hub request timeout and model response byte cap release resources.

The guard is an admission check, not a hardware VRAM reservation. It cannot guarantee memory availability against another process consuming VRAM after the check, and the in-process OCR lock does not coordinate multiple Hub replicas. Production multi-replica deployments need a shared distributed lock and a single dedicated model service (or an equivalent GPU scheduler). Do not claim GPU safety based only on unit tests or mocked telemetry.

## 5. Browser and release checks

In a browser, upload two PDFs, verify each page including the final column of page two, select both documents, compare matching IDs across formatting variants, and inspect unclear findings without a transcript dump. Reload and switch between the built-in apps; each should restore its last saved state. Verify keyboard access, progress, failure recovery, and that a failed model request does not erase extraction data.

Release only when fast checks pass, API authorization and request-limit cases pass, and the target-host GPU run meets the acceptance criteria. Record checks as **passed**, **failed**, or **not run**; do not present mocked model/GPU tests as hardware verification.
