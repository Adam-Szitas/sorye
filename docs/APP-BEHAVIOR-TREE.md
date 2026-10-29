# Sorye app behavior tree

This is the static map of the main user and data flows in Sorye. It is intended to be read in the repository, in code review, or in a Markdown viewer that renders Mermaid. It has no controls or interaction.

For a self-contained local page with handler-by-handler node details, open [APP-BEHAVIOR-TREE.html](./APP-BEHAVIOR-TREE.html).

**Update rule:** when a code change adds, removes, or changes one of the flows, state owners, trust boundaries, or app integration edges below, update this diagram in the same change. Root [`AGENTS.md`](../AGENTS.md) makes this part of the repository-wide contribution process.

## Open an app and keep its state

```mermaid
flowchart TD
    Person[Person in browser] --> SignIn[Sign in / restore session]
    SignIn --> Identity[Hub resolves user and active workspace]
    Identity --> Shell[Hub shell]
    Shell --> Catalog[App launcher and catalog]
    Catalog --> Choose{App kind}

    Choose -->|Hub-native| Native[Catalog, Reports, Storefront, Site, Mail, Drive]
    Choose -->|Module Federation remote| Remote[Dashboard, Calendar, Notes, Tasks, Relay, Protocolio, Canvas, DevKit, Messenger, OCR, Studio]
    Choose -->|External app| Iframe[SUSM / ESPM iframe]

    Remote --> Mount[Remote exposes mount(container, kernel)]
    Native --> AppUI[App UI]
    Mount --> AppUI
    Iframe --> AppUI
    AppUI --> Refresh[Visible-page refresh; hidden or offline tabs pause]
    Refresh --> Notifications[Notifications: events plus 60-second safety refresh]
    Refresh --> SessionSync[Standalone workspace: focus, reconnect and 5-minute safety refresh]

    Shell --> PaneState[Pane selection and split layout]
    PaneState --> SessionStore[sessionStorage: sorye:hub:panes]
    AppUI --> AppState[App-private UI state]
    AppState --> Memory[React state while mounted]
    AppState --> AppPersistence[App-owned browser or Hub persistence]
    Memory --> KeepMounted[Switching panes hides visited apps; keeps them mounted for this Hub session]
    AppPersistence --> Reopen[Reopen / reload restores only the state that app explicitly saves]
    KeepMounted --> Reopen
```

`packages/platform/src/refresh.ts` owns bounded, non-overlapping background reads and coalesces event bursts. Full-page/standalone kernels use `sync.ts`: workspace and notifications refresh independently. The shell uses `use-hub-session.ts` for session revalidation and `use-notifications.tsx` for the same visible-only notification policy. Focus/visibility/reconnect refresh current data, and unmount aborts outstanding reads and removes timers/channels. Notification events do not refetch the standalone workspace. In Postgres mode, OCR submissions enter a durable Hub job queue; a separately run OCR worker extracts/analyzes the PDF and the browser polls the authorized job endpoint for progress. The local JSON development path retains direct analyze/continue requests.

## Shared app requests and cross-app work

```mermaid
flowchart TD
    App[Hub-native app or remote] --> Request[Same-origin /api request with session credentials]
    App --> Kernel[Platform kernel client]
    Kernel --> EventOrHandoff{Intent}
    EventOrHandoff -->|event| Events[POST /api/events]
    EventOrHandoff -->|handoff| Handoffs[POST /api/handoffs]
    Request --> API[Hub API route]

    Events --> API
    Handoffs --> API
    API --> Auth[Authenticate with ensureHubUser]
    Auth --> Scope[Derive workspace from server session]
    Scope --> Validate[Validate route input and app permissions]
    Validate --> Store[Hub store / service]
    Store --> Durable[(Postgres or Hub .data metadata)]
    Store --> BlobStore[(Workspace-scoped Drive blob store)]
    Durable --> Result[Scoped response to caller]
    Result --> App

    Events --> Relay[Feature-gated Relay delivery]
    Relay --> Messenger[Messenger #events]
    Relay --> Webhook[Durable Postgres job → supervised Relay worker → allowed HTTPS webhook]
    Relay --> Notice[Hub notification and app badge]
    Handoffs --> Queue[Workspace-scoped handoff record]
    Queue --> Poll[Target app polls unconsumed handoffs]
    Poll --> Target[Target app imports the payload]
```

Apps do not call each other directly. Shared APIs, events, and handoffs pass through Hub, which owns authentication and workspace scoping. Events use Relay; structured app-to-app payloads use the handoff store.

Canvas board edits remain durable in the configured Canvas store. After a save or deletion, Hub publishes a small PostgreSQL `LISTEN/NOTIFY` invalidation so SSE subscribers connected to any Hub instance reload the authorized board from its authoritative store. Presence remains process-local and will be shown only to users connected to the same Hub instance until shared presence storage is added.

Tasks, Notes and Calendar save whole workspace documents with an expected revision. Hub atomically rejects stale revisions with HTTP 409. The edited draft stays in the app and is also kept in app-specific browser `localStorage`; users can download that draft or explicitly discard it and reload the latest server version before continuing.

## OCR to Protocolio

```mermaid
flowchart LR
    User[User selects one or more PDFs] --> BrowserRead[OCR browser reads layout and builds row / column matrices]
    BrowserRead --> MatrixReview[Review, edit, or select extracted tables]
    MatrixReview --> Combine[Compare selected PDFs]
    Combine --> Normalize[Normalize row IDs: 01.11.05 A = 1.11.5A]
    Normalize --> Merge[Align rows with matching normalized IDs]
    Merge --> Findings[Show unclear findings; no transcript in the reading export]
    MatrixReview --> CSV[Download CSV]

    User --> Analyze[Optional Node.js analysis of source PDF]
    Analyze --> UploadAPI[POST /api/ocr/analyze]
    UploadAPI --> Limits[Hub checks auth and bounded upload]
    Limits --> Driver{Store mode}
    Driver -->|Postgres| Queue[(Durable bounded job queue)]
    Queue --> Poll[OCR remote polls authorized job status]
    Queue --> Worker[Separate OCR worker with shared GPU admission]
    Worker --> PdfJs[Node PDF.js reads every page into source rows]
    Driver -->|Local JSON development| PdfJs
    PdfJs --> Save[Store source rows and analysis in workspace scope]
    Save --> GPU[Check local GPU headroom before each inference]
    GPU --> Qwen[Qwen reads bounded Node row chunks]
    Qwen --> Pattern[Extract PDF type and normalize meaningful body rows]
    Pattern --> Complete[Validate three columns; restore omitted or altered values]
    Complete --> Table[One continuous table, then unclear findings and matching JSON]
    Pattern --> Save
    GPU -->|Low memory / telemetry failure| RowsOnly[Keep extraction; return rows_only]

    MatrixReview --> Send[Send selected matrix to Protocolio]
    Send --> HandoffAPI[POST /api/handoffs: source=ocr, target=protocolio]
    HandoffAPI --> HandoffStore[(Workspace-scoped handoff store)]
    HandoffStore --> Protocolio[Protocolio polls, validates and loads PDF template]
    Protocolio --> Draft[Protocolio saves editor draft in localStorage]
```

The browser matrix path supports table review, multi-PDF alignment, CSV, and the Protocolio handoff. The separate Node path preserves every raw PDF row and asks the model for meaningful data in three columns: position/variable, description/calculation, period/result. In Postgres mode, OCR work is durably queued and handled outside the interactive Hub request; progress is available through the workspace/user-authorized job status endpoint. A database-backed heartbeat must be fresh before uploads are accepted. The worker lease is renewed while processing, and cancellation/lost ownership aborts ongoing work between PDF pages and model batches. The local JSON development path remains direct and process-local. `packages/types/src/ocr-table.ts` removes recognizable letterhead, repeated column headings, signatures and page numbers from the presentation; it preserves body notes, calculations and totals. It validates each AI cell against its source and restores missing or changed values into the same three columns. The reading page and JSON use this same projection, including for older saved readings, with filename, stored document ID and PDF type ID above a continuous table across all pages. Source page/row references remain in JSON. Unclear findings follow the table. Comparison matrices retain calculations and totals under their preceding position across page breaks. Hub GET responses apply the same normalization; raw stored pages remain unchanged. Inference resumes from the beginning if its stored prompt version is obsolete. Protocolio owns its editor draft; Hub pane state and OCR comparison/reading state have their own persistence lifetimes.

## Dashboard package map and LLM controls

```mermaid
flowchart TD
    User[Workspace member] --> Dashboard[Dashboard remote]
    Dashboard --> Plan[Hub session subscription + selected app IDs]
    Plan --> PackageMap[My package map]
    PackageMap --> Nodes[Always-available and purchased/enabled app nodes]
    Nodes --> HubRoutes[Hub events, files, and handoffs]

    Admin[Platform administrator] --> LlmTab[LLM & GPU Dashboard tab]
    LlmTab --> AdminApi[GET/PATCH /api/admin/llm]
    LlmTab --> Actions[POST /api/admin/llm/action]
    AdminApi --> AdminAuth[ensureHubUser + isPlatformAdmin]
    Actions --> AdminAuth
    AdminAuth --> Settings[Persisted provider, model, context, output, VRAM reserve]
    AdminAuth --> Telemetry[nvidia-smi + provider status + recent metadata events]
    Actions --> Pause[Pause/resume requests; optional Ollama model unload]
    Settings --> Inference[OCR inference admission and request bounds]
    Inference --> EventLog[In-memory metadata-only audit ring]
```

The package map derives its visible app nodes from the authenticated workspace session; it does not accept plan or workspace identifiers from the browser. GPU controls are platform-admin-only. Prompt and PDF content are excluded from the audit log. The free-VRAM setting is an admission reserve, not a hard allocator limit. Ollama model unload does not stop its daemon; vLLM requires the service operator to stop its service.

## Rodrigo capability boundary

```mermaid
flowchart LR
    Browser[Authenticated browser] --> Capability[Hub /api/backend/capabilities]
    Capability --> Session[Hub derives user and workspace]
    Session --> Assertion[Short-lived signed method/path/body assertion]
    Assertion --> Rodrigo[Independent Rodrigo Rust service]
    Rodrigo --> Verify[Verify signature, scope and request bounds]
    Verify --> Status[HTTP v1 capabilities: dataReady false]
    Rodrigo --> Metrics[Private metrics listener]
    Metrics --> Prometheus[Prometheus]
    Prometheus --> Grafana[Authenticated Grafana UI]
    Rodrigo -.-> Planned[Document/cache/blob interfaces; adapters not implemented]
```

Rodrigo is a separate repository and service. The Hub capability endpoint returns 503 if Rodrigo is unavailable or incompatible; it does not switch data owners. PostgreSQL, MongoDB, Redis and S3 adapters remain unimplemented. Existing Tasks/Notes/Calendar and other domain flows still use the Hub stores described above. Local Docker monitoring belongs to the Rodrigo repository. See [RODRIGO.md](./RODRIGO.md).

## State ownership at a glance

| State | Owner | Persistence / lifetime |
|---|---|---|
| User, active workspace, app access | Hub | Auth and workspace store; server derives scope per request |
| Dashboard package map | Dashboard view | Derived from authenticated `HubSession` subscription and selected app IDs; no separate saved copy |
| LLM runtime settings | Hub | `.data/llm-control.json`; platform-admin API only |
| LLM activity events | Hub process | Metadata-only in-memory ring (last 500); cleared when the Hub process restarts |
| Open panes and split layout | Hub shell | `sessionStorage` for the current browser tab |
| Visited app's in-memory editor state | App component tree | Kept while that app stays mounted in the current Hub session |
| OCR selected reading | OCR remote | `sessionStorage` |
| OCR multi-document selection and comparison | OCR remote | App-owned `localStorage` record |
| Tasks/Notes/Calendar stale-save draft | Respective remote | App-specific `localStorage` until the user downloads or discards it; never automatically replaces the latest server document |
| Protocolio template and editor mode | Protocolio remote | App-owned `localStorage` draft |
| Shared records and app workflows | Hub APIs and stores | Postgres or `.data`, depending on configured store |
| Event delivery and structured handoffs | Hub | Workspace-scoped Hub stores; target app consumes/polls |

When a feature changes where state lives or how long it survives, update this table and the state branch above. Do not imply that all app state survives a full browser restart: that is true only where the app explicitly persists it.
