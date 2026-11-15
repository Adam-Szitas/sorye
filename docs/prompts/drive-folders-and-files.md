# Drive: persistent folders, folder upload, and general file storage

## Objective

Implement BUG-002 so authorized workspace members can create folders, upload directory trees, navigate them after reload and from another signed-in device, and upload ordinary files beyond images/PDF. Block executable files on the server. Execute the implementation, tests and sandbox rebuild; documentation alone is not completion.

## Verified starting point

Drive is Hub-native (`apps/hub/components/app-files.tsx`). The shared Hub upload queue owns transfers. Rodrigo owns Drive metadata, quota, upload ledger and object bytes. Current Rodrigo `OpenFile` accepts file ID, display name, MIME, source app, size and checksum; it has no parent folder field. Its strict deserializer rejects unknown fields. Sorye's strict Drive DTO also has no folder reference. `WorkspaceFile.relativePath` is a generated storage locator, not a user folder path. Do not overload it or sourceAppId. The recent compact progress and destination-selector changes must be preserved.

## Deliverables and order

1. Read repository steering in Sorye and Rodrigo; inspect dirty files and preserve existing changes. Review both behavior maps and storage security rules.
2. Extend the authoritative Rodrigo contract and persistence model with workspace-owned folders and nullable file parent references. Root is an explicit null parent. Include listing and creation, durable empty folders, bounded nesting, normalized names and deterministic duplicate handling. Use scoped parent lookups, foreign keys where appropriate, transactional validation, and concurrent-create tests. Preserve existing root-level files through an additive migration. Keep migration/deployment source in Rodrigo.
3. Update Rodrigo's reviewed Sorye contract snapshot and DTOs, signed client and Hub routes. Derive workspace/user identity from the server session. Validate names, depth, lengths and parent ownership on both server boundaries. Reject traversal, absolute paths, drive letters, reserved/control characters, cross-workspace parents and cycles. Do not silently switch storage destinations on errors.
4. Add a clearly labeled New folder action with an accessible name dialog, inline validation and error recovery. Add Upload files and Upload folder actions. Preserve the compact toolbar, full-width file list and expandable upload details. Add folder rows, breadcrumbs, empty-folder state and keyboard navigation. Keep app-source groupings distinct from actual directories.
5. Implement directory selection using a browser directory picker with a supported fallback, plus recursive folder drop where supported. Read relative paths, create parent folders in bounded order, and carry folder/destination/workspace identity through the existing upload queue. Explain limitations for empty directory selection where a browser provides only files; support empty directories via New folder and directory-entry traversal where available. Do not claim unsupported browser behavior.
6. Keep uploads streaming and bounded. Large folder selections must queue in batches rather than silently discard files at the current batch ceiling. Retain quota/concurrency/throughput enforcement, retry/cancel/checksum behavior and progress across navigation. Display skipped/blocked files and reasons, total progress and actionable per-file failures. Retrying must not create duplicate directories or acknowledged files.
7. Broaden general Drive uploads to common documents, spreadsheets, presentations, text/data, audio, video, archives and other ordinary binary formats. Preserve stricter app-specific restrictions such as Tasks raster photos and OCR PDFs. Update picker filters and all client/server validators together. Detect executable signatures independently of names/MIME (Windows PE, ELF, Mach-O and executable script formats); block executable extensions, installers and scripts consistently, including case/renaming tricks. Document the exact policy. Archive acceptance must not be advertised as malware scanning: decide and document whether embedded executables are inspected, with bounded decompression if inspection is implemented. Never execute uploaded content.
8. Serve untrusted non-preview formats as downloads with nosniff and safe Content-Disposition. Keep active HTML/SVG/script content out of same-origin inline preview. Preserve existing safe preview and OCR handoff behavior.
9. Apply storage capabilities explicitly: default workspace storage and configured own-storage targets use durable folder metadata; separately connected cloud buckets need deliberate prefix/empty-folder semantics and authorization. Expose unsupported operations clearly until their contracts are implemented. No fake folders in localStorage or credentials in the browser.
10. Update BUG-002 with implemented versus remaining scope; update both behavior maps, Drive landing copy/translations and relevant architecture/API docs. Do not change admin quota policy as an incidental bypass of limits.

## Acceptance and verification

- Create an empty folder, reload, and verify it in another authorized session.
- Upload a tree with nested folders, duplicate basenames in different folders and mixed ordinary file types; verify hierarchy and downloaded checksums.
- Select more than one browser batch; every eligible file is queued or explicitly reported, with no silent loss.
- Test two users creating the same sibling folder concurrently, retries after network failure, workspace changes during upload, and storage failures.
- Reject cross-workspace folder reads/writes, forged parent IDs, traversal, over-depth paths, oversized files, executables disguised by name/MIME and unsafe inline rendering.
- Check keyboard, narrow and wide layouts. Collapsed progress stays compact while errors and retry controls remain discoverable.
- Run required Rodrigo formatting/lint/test and signed contract checks, Sorye type checks and focused browser integration tests.
- Apply the additive migration to the sandbox without erasing data; run update-sandbox.ps1; verify DB schema, Rodrigo readiness, authenticated folder operations and actual browser upload/download. Record failures honestly.

## Completion criteria

Do not mark complete based on healthy containers or a file picker alone. The durable folder contract, UI, queue, safety checks and cross-session browser acceptance must pass. Provide the local test URL and summarize remaining limitations explicitly.

## Execution record — 2026-11-14

Implemented in Sorye and the separate Rodrigo repository. The storage model uses validated, immutable workspace-relative paths instead of parent IDs; see [the implementation contract](../DRIVE-FOLDERS.md). This preserves hierarchy without introducing cycles or changing object keys. Folder moves/deletion are not included. Live database/S3 tests and browser verification are recorded in BUG-002. Cloud-marker creation is implemented but external AWS/R2 acceptance needs a configured test connection. The folder picker cannot return empty directories; New folder and supported directory drop cover them. Archive contents are not scanned.
