# Sorye and Rodrigo architecture explorer

Open [the interactive HTML guide](SORYE-RODRIGO-EXPLORER.html) directly in a browser. It works offline without a server, installation or application credentials. Select a component, inspect its connections, or follow a guided request from browser intent to durable ownership.

The [implementation prompt](prompts/architecture-explorer.md) defines the scope, evidence rules, interactions and acceptance criteria. The page documents existing behavior; it does not change runtime routing or add a customer app.

## What you can explore

- **Core path:** browser/native/remote apps, scoped IndexedDB actions, Hub authentication and assertions, Rodrigo identity/records, PostgreSQL, change feed and read caches.
- **Storage:** Drive edge checks and streaming, metadata versus S3 bytes, sandbox RustFS, Site revisions/media, customer bucket/PostgreSQL destinations, credential vault, optional database adapters and remaining Hub stores.
- **Compute:** Hub OCR jobs/worker, optional Ollama/vLLM, server GPU versus Studio browser WebGPU, GPU guard visibility, Protocolio and its own MongoDB, implemented service-token capability versus unwired future coordination.
- **Observability:** Rodrigo metrics, Prometheus scrape direction and actual target scope, Grafana, optional Sentry, GPU snapshots versus exporters, and Hub Reports statistics.

The implementation view includes labeled optional and planned paths. The sandbox view includes only its observed internal components/relationships. A node outside the selected view is revealed when selected through a connection or guided journey. Search matches responsibility, configuration and connection routes, in addition to names. Component/connection selections, environment, focus area and journey step can be bookmarked through the URL hash. Static anchors still navigate the document sections.

The map’s connection list is a textual alternative to the arrows. Keyboard controls use native buttons/selects; the inspector has a jump link. At narrow widths the graph scrolls inside its own region and the inspector appears beneath it. Printing expands all component/connection details and guided journeys, regardless of current filters. With JavaScript disabled, the static overview, ownership table, glossary and sources remain available.

## Evidence and limitations

Snapshot: **13 November 2026**, Sorye `140643e`, Rodrigo `1645efc`. Source references on each component point to the implementation examined; these commit labels identify the pre-documentation baseline, not a promise that a later checkout has not changed. The sibling Rodrigo checkout is linked relatively and is needed to open those source files locally.

Checked-in sources establish implemented behavior. A sanitized Docker container inventory establishes the presence and ports of local stacks at that time. It does not establish production topology, DSN configuration, model availability, GPU capacity or every end-to-end connection. The page deliberately contains no live traffic probes, metrics queries, secrets or fabricated utilization statistics.

Important findings reflected in the guide:

- Current Rodrigo ownership includes identity and storage, in addition to migrated app records. Old statements that Rodrigo has no durable adapters or does not own Task image bytes are stale.
- Hub still owns events/Relay, notifications, OCR jobs, Mail and remaining domains. A Rodrigo resource-change stream is not the product-event pipeline.
- `issueServiceToken` has a client and tests, but no current OCR/Protocolio production caller was found. Token-aware compute and job leases are roadmap edges.
- The separate local Prometheus configuration targets `rodrigo:9091` in its own Compose stack. It does not automatically scrape the sandbox Rodrigo. No GPU exporter was verified.
- Host Ollama/Protocolio presence does not make them reachable from the sandbox’s internal network.
- The VM/delivery/monitoring document remains a future infrastructure proposal; the explorer describes current implementation separately.

## Verification and maintenance

Run from the repository root:

```powershell
node scripts/check-architecture-explorer.cjs
```

The check uses the repository’s existing Playwright installation and Chromium. It validates the content model and source links, then exercises node/edge inspectors, views, search/empty/reset, sandbox filtering, all journeys, keyboard activation/focus, deep-link reload, browser back/forward, 390/320-pixel layouts, complete print output, no-JavaScript content and absence of external requests. Screenshots and a print PDF go to ignored `.local/architecture-explorer-qa/`. Sibling source-link validation is skipped when Rodrigo is not checked out beside Sorye.

Maintain the `nodes`, `edges` and `tours` datasets together in the HTML. Keep source links, implementation status, deployment scope, ownership table and static caveats aligned. Recheck actual call sites when a capability becomes a live integration; do not change an optional/planned edge to current solely because an endpoint exists. Update the evidence snapshot after a fresh audit.

Use [the behavior tree](APP-BEHAVIOR-TREE.md) for runtime user-flow changes and [alignment status](HUB-RODRIGO-ALIGNMENT.md) for migration progress. The explorer is a learning view, not a replacement authority for contracts or configuration.
