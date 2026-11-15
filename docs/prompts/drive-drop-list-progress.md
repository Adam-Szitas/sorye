# Prompt: Make Drive's drop zone useful, show folders in the file list, and clear completed upload progress

Implement this prompt in the current Sorye worktree. Do not stop after writing this document.

## Goal

Improve the Hub-native Drive experience so the upload target is an obvious, generously sized drop surface; users can drop individual files, batches, folders, and batches of folders onto the main Drive content area; folders appear beside files in the same browsable list with useful dates and accurate child counts; and successfully uploaded file progress rows disappear three seconds after completion.

Preserve the existing Hub upload queue, Rodrigo ownership, selected storage behavior, folder path model, file policy, responsive shell, and current uncommitted work.

## Inspect before changing

Read root `AGENTS.md`, `docs/AGENTS.md`, `docs/SECURITY.md`, `docs/DRIVE-FOLDERS.md`, both behavior trees, and Drive landing guidance. Inspect `git status`. Trace:

- `apps/hub/components/app-files.tsx`: current short drop panel, folder buttons, file table, selected destination and current directory.
- `apps/hub/lib/drive-drop.ts`: bounded file/system-entry traversal and empty-directory handling.
- `apps/hub/lib/upload-queue.ts`: terminal statuses, completion timestamps, retry, cancellation and subscribers.
- `apps/hub/components/upload-progress.tsx`: batch and per-file progress UI.
- `apps/hub/app/api/files/folders/route.ts`: authenticated, workspace-scoped folder creation.
- `packages/types/src/files.ts` and Rodrigo Drive-folder contract for metadata and path ownership.
- The latest layout at desktop, tablet and mobile widths. Do not alter cloud-object semantics or allow browsers to select workspace identity.

## Required product behavior

### Drop area

- Replace the tiny standalone dashed strip with a substantial, clearly labeled drop surface sized in proportion to the available Drive pane. It should be easy to discover without pushing the file list below the fold. Use responsive min-height/spacing, a clear title, concise supported-content hint, and an upload-button alternative.
- The **main Drive content surface** accepts drops across its safe interior. Leave the Hub shell, navigation/header controls, storage selector, search and actions outside the drop target so dropping cannot unexpectedly intercept navigation or buttons. Retain a visible drop surface as the discoverable target.
- Accept one or many files, one folder, or many folders. Keep current recursion bounds (2,000 total entries and 16 levels), safe path validation, blocked executable policy, upload-size/count limits, queue bounds, selected-workspace guard and selected storage destination.
- Preserve each dropped folder's relative hierarchy and duplicate basenames. Create empty directories when available from the browser entry API. Queue files only after required folder creation succeeds; if creation partially fails, report what happened clearly and do not claim the whole drop succeeded.
- Do not switch destination or workspace as a side effect of the drop. State where files will go before/while dragging. Ensure folders dragged from the Drive's own list are not re-imported as uploads.
- Handle nested drag events without flickering: track enter/leave depth or use a containment check; ignore unrelated dragged text, links and browser-internal items. Prevent browser navigation only for a valid file/directory drop. Provide distinct active/invalid visual states and short accessible announcements.
- Keep click, keyboard and touch alternatives: file picker and directory picker where supported, plus New folder for empty directories where picker APIs omit them. Do not require drag and drop.

### Folders in the same list as files

- Remove the separate row of child-folder buttons as the primary folder browser. Render folder entries alongside file entries in the current Drive list/table, with a folder icon, accessible open action and the same visual row rhythm as files. Folders appear before files; apply a clear, deterministic natural/case-insensitive sort within each group.
- A folder represents one canonical path in Rodrigo. Derive its child count from the current authorized Drive metadata and folder-path lists:
  - Count files directly in that folder and immediate child folders only (do not include all descendants recursively).
  - Include empty child folders.
  - Label semantics explicitly, e.g. “4 items” where an item is a direct file or immediate child folder. A root row reports its immediate entries.
  - Never expose sibling-workspace metadata or infer contents from untrusted browser state.
- Display the folder's available created/updated date. Current Rodrigo folder records contain paths only, with no folder timestamps. Do not fabricate folder dates or use page-load/current time as a creation date. If no authoritative date exists, render a neutral “Folder”/“—” for that column, and document the current contract limitation; do not add speculative timestamps to the UI. Keep actual file uploaded-at date visible and label it accurately as upload/creation date (use authoritative `createdAt`, not mutable `updatedAt`, if the column means uploaded-at).
- Clicking or keyboard-activating a folder opens it using the existing logical `directoryPath`, breadcrumbs and workspace scope. Make the row affordance and nested list work at narrow widths without page-wide horizontal overflow.
- Search, Personal/Work partitions, source-app grouping, cloud storage listings, previews, sharing controls, selection state, drag targets and empty states must remain coherent. Do not make a Relay cloud prefix look like a workspace Drive folder.

### Completed upload progress

- When a Drive file reaches successful `done`, remove its per-file progress row after **3,000 ms**. The batch summary may also collapse when no transfers remain; never leave a completed progress block taking space indefinitely.
- Keep active/queued uploads visible until terminal. Keep failed, corrupted, and canceled rows visible with their existing error, retry/cancel/dismiss behavior. Do not auto-dismiss failures, including a failure followed by successful retry; the retry gets a fresh three-second timer only after it reaches `done`.
- Preserve the top-bar upload indicator semantics and other apps' transfer behavior. Do not delete or mutate durable Drive records to hide a UI row.
- Implement timeout cleanup without leaking timers/subscriptions across unmounts, workspace changes, hot reloads or queue completion. Prefer deriving visibility from `finishedAt` in a focused selector or central queue expiry with bounded timers; make behavior deterministic under fake clocks. Clean up listeners on unmount and keep other app queues unchanged.

## Visual and accessibility quality

Use current app styling tokens and established Drive row patterns. Maintain compact full-width behavior after upload completes, with no fixed overlay covering controls. Drop state must not be communicated by color alone. Use semantic buttons, labels and status announcements; keyboard users retain all navigation and upload actions. Preserve visible focus, reduced-motion behavior, sufficient contrast, browser zoom and small-screen layout.

## Testing and acceptance

Add focused, meaningful tests for:

1. Drop surface accepts a single file, multiple files, nested folder and multiple folders; preserves relative paths and empty directories; enforces entry/depth bounds; ignores unrelated drags and nested drag-leave flicker.
2. Main content is a valid drop target while shell/header controls remain usable; file-picker alternatives still work.
3. Folder/file mixed list sorting, immediate child item counts including empty folders, direct-file counts, breadcrumbs and narrow viewport behavior. Verify no invented folder timestamps and the correct uploaded-at source.
4. A completed upload row disappears at 2,999 ms and at 3,000 ms; active transfers remain; failed/corrupted/canceled rows remain; retry success restarts the timer; unmount/workspace switch produces no leaked work or cross-workspace queue effect.
5. Existing destination, workspace stale-guard, file-type, quota and cloud-storage behavior remains unchanged.

Run Hub typecheck and the focused tests. Use browser verification at desktop and narrow widths to exercise dragging a folder and multiple files, opening a mixed folder/file list, upload completion cleanup, retry-visible errors, keyboard navigation, and the Hub shell controls. Do not rebuild the sandbox unless required for a meaningful end-to-end test; if done, preserve existing volumes.

## Documentation

Update `docs/DRIVE-FOLDERS.md` with truthful folder counts, timestamp limitation and drop bounds. Update both behavior maps only if the drop/user flow or state ownership is described there and has changed. Review all five Drive landing translations for accuracy without claiming unsupported behavior. Preserve unrelated documentation and uncommitted edits.

## Completion report

State the changed files, observed drop-zone dimensions/behavior, folder count/date semantics, the three-second dismissal evidence, tests/browser checks, and any browser/API limitation. Never claim folder creation timestamps exist until Rodrigo contract/storage actually supplies them.
