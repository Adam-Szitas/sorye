# Drive folders and upload policy

Drive → authenticated Hub APIs → signed Rodrigo APIs → PostgreSQL folder/file metadata and the selected object provider. Workspace identity comes from the session and verified assertion.

`GET/POST /v2/files-folders` lists or idempotently creates workspace-relative folder paths. `folderPath` on `DriveFileOpen` and `DriveFile` is separate from immutable object keys. Root is the empty string. Paths have at most 16 segments, 1024 UTF-8 bytes total and 180 bytes per segment. Traversal, absolute paths, controls and reserved path characters are rejected. A workspace holds at most 2,000 folders. Concurrent creates serialize per workspace and converge on a unique `(workspace_id,path)` row. Folder creation precedes upload reservation; failed uploads may leave empty folders. Folder moves/deletion are not part of this change.

Rodrigo migration `014_drive_folders.sql` is additive; existing files remain at root. Folder paths replace the prompt's proposed parent IDs: no rename/move operation is exposed, and validated immutable paths cannot form cycles. Default S3 and configured own storage share workspace metadata; changing the byte target does not move existing objects.

Relay cloud folders use `POST /v2/cloud-storages/{storage}/folders`, storing a create-only, zero-byte `.sorye-folder` marker. This reserved name is hidden in listings and blocked for user uploads. File uploads retain directory prefixes; credentials remain in Rodrigo.

Workspace Drive quota is authoritative and includes used bytes, the configured byte limit when one applies, file count and maximum. A connected S3/R2 bucket has no standard total-usage or capacity value in its contract. Drive reports the listed file count and immediate file-byte sum for the currently open cloud folder, and labels it as folder-only; it does not present this as a recursive bucket total.

The browser queue preserves relative paths and limits active transfers independently of selected file count. Workspace file/byte quotas remain enforced by Rodrigo. Directory selection cannot include empty directories in browsers that supply only files; New folder and directory-entry drop support empty folders. Dropped traversal is bounded to 2,000 entries and 16 levels.

Hub checks blocked extensions and Windows PE, ELF, Mach-O, Java/WASM and shebang signatures before streaming to Rodrigo. Unknown ordinary formats are download-only `application/octet-stream`; existing safe preview types keep their previews. This is not malware scanning: archive contents are not extracted or inspected, and arbitrary scripts without recognizable signatures cannot reliably be identified after renaming. Archives may contain executable files; the outer file policy does not certify their contents. Tasks photo restrictions remain in effect.

## Sandbox acceptance

2026-11-14: rebuilt both services and restarted the sandbox without deleting volumes. PostgreSQL and signed PostgreSQL/S3 readiness checks passed. The browser bridge verified the new controls at `http://127.0.0.1:23000/apps/files`, folder creation, 12/12 queued directory files, nested navigation, and rejection of MZ bytes disguised as `.txt`. A YAML download returned identical content, attachment disposition and `nosniff`. After the final rebuild, all 12 nested records and both folders persisted. A second browser session at 390px width opened the hierarchy without page overflow. Hub rejected traversal (400), stale workspace guards (409) and malformed storage destinations (400). Test artifacts remain under `Drive verification/Mixed` for local inspection.

Rust formatting, strict Clippy and tests passed; Hub typecheck, signed contract tests, general-file policy and cumulative-quota queue tests passed. Live disposable PostgreSQL/S3 tests passed including duplicate basenames in separate folders, eight concurrent folder creates, cross-workspace denial, restart persistence, own storage targets and unavailable storage failing closed. External AWS/R2 marker creation still needs live acceptance with a configured test connection. `update-sandbox.ps1` now reapplies the idempotent Rodrigo folder migration before updating containers.
