# Local OCR + Qwen3 8B

This workstation has an NVIDIA RTX 5070 with 12 GB VRAM. The `qwen-local` Docker profile runs quantized `qwen3:8b` with Ollama. The full-precision vLLM `qwen` profile is retained for larger GPUs; do not start both profiles, since both bind localhost port 8000.

## Start after a reboot

Start Docker Desktop with the WSL2 backend, then in PowerShell from `D:\projects\sorye`:

```powershell
docker compose --profile qwen-local up -d postgres qwen-local
docker exec sorye-qwen-local ollama list
# First installation only, or if the model volume has been removed:
docker exec sorye-qwen-local ollama pull qwen3:8b
```

Keep these settings in `apps/hub/.env.local` alongside existing secrets:

```dotenv
OCR_LLM_PROVIDER=ollama
OCR_LLM_BASE_URL=http://127.0.0.1:8000
OCR_LLM_MODEL=qwen3:8b
OCR_GPU_GUARD=true
STORE_DRIVER=postgres
DATABASE_URL=postgresql://sorye:sorye@localhost:5432/sorye
```

The GPU guard requires `nvidia-smi` on the **Hub host**. It fails closed if telemetry cannot be read. It is optional for other machines and disabled unless explicitly set to `true`.

Start Hub and OCR in separate terminals (do not start duplicates if they are already running):

```powershell
Set-Location D:\projects\sorye\apps\hub
node node_modules/next/dist/bin/next dev --turbopack --hostname 127.0.0.1 --port 3000
```

```powershell
Set-Location D:\projects\sorye
.\pn.cmd dev:ocr
```

Open [OCR](http://localhost:3000/apps/ocr), upload `test-documents/sorye-ocr-qwen-test.pdf`, then click **Analyze with Qwen**. Start with the three-page PDF before the twelve-page coverage test.

The existing development auth bypass is enabled only for local development. The Hub command above binds to `127.0.0.1`.

## What the tests contain

| File | Purpose |
| --- | --- |
| `test-documents/sorye-ocr-qwen-test.pdf` | Three pages: invoice total EUR 216, seven expressions, and page-end markers including `FINAL-SENTINEL-OMEGA-7391`. |
| `test-documents/sorye-ocr-qwen-12-pages.pdf` | Twelve pages and 240 synthetic inspection records, requiring multiple sequential model calls. |
| `test-documents/*.expected.json` | Exact body lines to compare with extracted rows. |

These are selectable-text PDFs, not scanned-image accuracy tests. Regenerate them with `node scripts/generate-ocr-samples.cjs`.

## GPU orchestration

The Node.js Hub owns admission and inference requests. The OCR browser app never calls the LLM directly.

LLM participation is opt-in: all of `OCR_LLM_PROVIDER` (`ollama` or `vllm`), `OCR_LLM_BASE_URL`, and `OCR_LLM_MODEL` must be explicitly set in the Hub environment. Restart Hub after changing them. There are no implicit connection defaults. Before inference, Hub probes the running server (three-second timeout) and requires the configured model in Ollama `/api/tags` or vLLM `/v1/models`. Ollama weights can remain unloaded until an actual inference request; Hub never starts a server or downloads a model. Missing/invalid configuration, an offline server, or a missing model excludes the LLM stage and saves `rows_only`, preserving extracted rows and any previous partial pattern. A server failure during inference stops the remaining sections without repeated inference attempts. Cleanup only contacts a model that was used.

- One active document per Hub process, across workspaces and browser tabs. Excess requests receive HTTP 429 plus `Retry-After`; they are not queued in memory. The lock survives Next development module reloads and releases on errors.
- A one-second pause after a completed document prevents rapid restarts. After model availability is verified, the optional local GPU guard skips the LLM stage if less than 1,536 MiB is free or the reported temperature is at least 85 C; PDF extraction is retained as `rows_only`.
- Transcript chunks are at most 4,000 UTF-8 bytes. The combined system/user input is rejected above 6,000 bytes; source rows are never shortened to fit.
- One sequential model call per chunk, with 8,192 context tokens, at most 1,800 generated tokens, thinking disabled, and batch size 128 in Ollama.
- The model returns compact representative records rather than copying every source record into its limited output. Every extracted source row and detected math annotation remains in storage independently of model output.
- Each model request is limited to 90 seconds; the document request has a 240-second processing budget shared with client cancellation. Remaining rows are retained with `rows_only` if summarization cannot finish. The extraction itself is synchronous PDF.js work and is not forcibly terminated by the inference deadline.
- Docker/Ollama allows one parallel request, one loaded model and one waiting request. It reserves 1.5 GiB in its GPU allocation estimate, uses a quantized KV cache, and unloads an idle model after two minutes. Cloud features are disabled and the API binds to localhost only.

The reserve and telemetry checks are safeguards, not a hardware partition. Other programs can consume GPU memory after admission. GPU utilization can reach 100% during a generation; this setup limits concurrency and memory demand, not power draw or utilization percentage. Multiple Hub processes require a shared admission queue; this local lock alone is not distributed.

## Verify and observe

```powershell
node --test apps/hub/lib/ocr/ocr.test.cjs
node scripts/test-ocr-local.cjs
node scripts/test-ocr-local.cjs --large
node scripts/test-ocr-browser.cjs
docker exec sorye-qwen-local ollama ps
nvidia-smi
```

Run live tests sequentially. Two API tests each send a competing upload to verify backpressure. They also compare every source body line and the complete stored transcript/pattern after reading it back from Hub. Browser testing uses Edge headlessly and suppresses workspace event emission so configured Relay rules cannot forward synthetic test events.

Reports and screenshots are kept under ignored `.data/ocr-local/`. The current Hub background logs are `hub.stdout.log` and `hub.stderr.log` there. The test records persist in local PostgreSQL. The setup added only `ocr_analyses` and its index using `scripts/ocr-local-schema.sql`, without pushing unrelated schema changes.

Hub unloads `qwen3:8b` when an analysis finishes. If the Hub process dies mid-request, Ollama drops the weights after 30 seconds. The container is limited to 10 GB of RAM. To free model memory by hand: `docker exec sorye-qwen-local ollama stop qwen3:8b`. To stop the model container: `docker compose --profile qwen-local stop qwen-local`. Avoid `down -v` unless you intend to delete model/database volumes. The vLLM `qwen` profile holds VRAM until that container stops.

The OCR audit's remaining architectural limitations still apply: native-text extraction does not recognize text inside scanned images; originals are not archived; the saved format remains page arrays; application-level encryption is not implemented; and extracted rows are written after inference completes or returns a caught error. The live setup should not be mistaken for completion of those separate features.
