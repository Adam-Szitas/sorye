# Drive compact list, drop target, and text rendering

## Prompt

Improve the Hub-native Drive interface in `apps/hub/components/app-files.tsx` while preserving its current upload, folder, storage, quota, sharing, and workspace behavior.

### Main interaction changes

- Remove the standalone, tall dashed “Drop files or folders to upload” panel. Do not create another dedicated drop-only container.
- Keep the existing file-list viewport (`relative min-h-0 flex-1 overflow-auto ...`) as the single drop target for files, multiple files, directories, and nested directory contents. Keep its drag enter/over/leave/drop handlers, and make the whole viewport visibly highlight while a compatible file or folder is dragged over it.
- Give the list a short, low-profile instruction that tells users they can drop files or folders anywhere in the list. Keep the empty state useful and ensure the list still fills available app height.
- Remove folder-path shortcut chips from the `mx-4 my-2 ...` toolbar area. A logical folder must appear once in the file list as a folder row alongside files. Keep folder navigation through the location breadcrumb and preserve folder item counts and folder sharing actions.
- Retain explicit New folder and Upload folder actions. Keep root/current-folder sharing reachable, and do not remove the folder picker, upload queue, or storage-specific upload behavior.

### Compact layout

- Reduce unnecessary vertical padding and gaps across the Drive header, action row, storage destination selector, quota/progress summaries, breadcrumbs, and list controls while keeping clear hierarchy and touch-usable buttons.
- Make the search input materially narrower and place it beside a compact related control (such as Regex or folder actions); it must not expand across all remaining width.
- Keep the selected Workspace Drive / connected-storage cards readable and compact. Set explicit text sizing, line-height, and font family where needed so icons or selected state cannot corrupt the label typography.
- Render file and folder sharing actions as compact share icons rather than visible “Share” text buttons. Keep a meaningful accessible name and title for each icon button and retain the 44px touch target.
- Keep the app fitted to its available Hub pane height. Avoid a fixed-height drop panel or extra nested scrolling regions.
- Preserve responsive behavior at narrow widths; controls can wrap, but the page must not gain horizontal overflow.

### Character and icon integrity

- Audit all user-visible literals in the Drive component for common UTF-8 mojibake (for example `â€¦`, `Â·`, `â€”`, `âœ“`, and `â–¤`). Replace them with correctly encoded UTF-8 text or small inline SVG icons from the existing visual style.
- Do not rely on emoji or uncommon font glyphs for the storage selector, selected check, folder, or upload indicators. Decorative SVGs need `aria-hidden="true"`; icon-only controls need accessible names.
- Keep interpolation and user-supplied filenames escaped by React; do not normalize or alter user file names.

### Constraints

- Preserve server-side executable blocking, size/count/storage limits, directory relative paths, folder creation, S3/R2 selection, public-sharing controls, and the shell-owned upload queue.
- Do not add app-to-app calls or client-trusted workspace authorization.
- Keep source and visible architecture documentation aligned. Update the Drive landing copy if needed; keep its translated variants consistent.

### Verification

- Run the focused Drive/Hub checks and Hub typecheck.
- Verify at least: dropping a file on the list calls the upload path; dropping a directory preserves paths and creates folders; folders appear once as rows, not toolbar chips; New folder and Upload folder remain usable; each storage destination stays selectable with readable text; keyboard and touch controls remain accessible; 320–390 px layouts do not overflow; and there are no visibly mojibaked Drive literals.
- Report any behavior that cannot be verified because the relevant service or browser bridge is unavailable.
