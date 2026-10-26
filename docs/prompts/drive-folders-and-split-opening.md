# Prompt: Drive folders and left/right app opening

Update Sorye's Hub-native Drive and app-opening experience using the existing Hub architecture.

## Requirements

- Treat each file's `sourceAppId` as its existing app folder. Files tagged `files` (including legacy files with no source) live at Drive root.
- At Drive root, show root-level files and folders that contain files. Opening a folder shows only its files.
- Replace the current folder-button strip with a compact, accessible breadcrumb (`Drive / Folder`) that returns to root.
- Keep search, upload, preview, rename, delete, and file handoffs working.
- Apps can be opened on either side of the Hub split workspace. Reuse `PaneSide`, `AppLauncher`, the shell's `openApp`, `HUB_OPEN_APP_EVENT`, and `AppWorkspace`; do not add app-to-app imports or a second pane state store.
- Preserve the existing full-page app launch path when no pane side is selected. Respect app availability, admin access, and the current selected-app rules.

## Architecture references

- `docs/ARCHITECTURE.md` (Hub shell and split panes)
- `docs/AGENTS.md` (Hub-native app and app-to-app rules)
- `apps/hub/components/app-launcher.tsx`
- `apps/hub/components/hub-shell.tsx`
- `apps/hub/components/app-workspace.tsx`
- `apps/hub/components/app-files.tsx`

Implement the requirements in the existing components, preserve unrelated workspace edits, and run only the relevant typecheck/build validation requested by the task owner.
