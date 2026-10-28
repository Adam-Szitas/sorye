# Implementation prompt: first class apps and state restoration

Update Sorye Hub so ProtocolIO behaves as a first class built-in workspace app and users can switch between apps without losing their current work.

## Product behavior

- ProtocolIO must open inside the Hub workspace through the normal app launcher and split-pane controls, using its existing catalog entry and micro-frontend mount. Do not send the user to a separate product or require another sign-in for Hub's developer bridge.
- Preserve the current cross-app handoff contract. When OCR sends a `pdf-template` handoff to ProtocolIO, opening ProtocolIO must load that template, show a clear handoff notice, and mark the handoff consumed only after a valid template is loaded. Keep the existing optional auto-generation behavior and error reporting.
- When a user replaces an app in a pane, opens another app, visits the launcher or app library, and later returns, each app should show the state they left. Preserve app component state for the lifetime of the Hub session, including ProtocolIO's active editor tab, visual/JSON mode, template edits, page settings, and unsaved JSON text. Switching panes or swapping left/right must not reset an app.
- Persist ProtocolIO's current valid template and editor selection across a browser refresh, with safe parsing and a versioned storage key. A malformed or outdated saved draft must fall back to the normal starter template without blocking ProtocolIO. Do not store API tokens or credentials in this draft.
- A new OCR handoff takes precedence over the restored ProtocolIO draft and becomes the new current draft. Reopening the app without a new handoff restores the user's own last edits.
- Closing an app pane or navigating away from the desk must not clear its draft. Explicit reset/clear actions may clear the relevant app's draft.

## Engineering constraints

- Keep the Hub app catalog, access checks, routes, and Module Federation mount as the source of truth for app launch. Do not duplicate ProtocolIO as a second catalog app.
- Keep previously opened workspace apps mounted but hidden while they are inactive, using stable app IDs as React keys. The active left/right panes alone should take layout space, receive focus actions, and expose visible controls. Preserve keyboard and screen-reader behavior for hidden panes.
- Ensure the active remote receives Hub kernel context and handoff events correctly. Hidden apps must not steal the active-app identity or duplicate user-visible notifications.
- Keep persistence local to each app and scoped to the current browser profile. Handle unavailable storage and invalid serialized data gracefully.
- Keep the existing OCR-to-ProtocolIO handoff payload shape and server-side API/token handling unchanged.

## Acceptance criteria

1. Open ProtocolIO, edit a block and page setting, switch the pane to another app, then reopen ProtocolIO. The edits and current editor view remain.
2. Swap ProtocolIO between left and right panes. The editor does not remount or reset.
3. Navigate from the workspace to the launcher and back. Open ProtocolIO and confirm its edits remain.
4. Refresh the browser and confirm the last valid ProtocolIO draft and editor selection restore.
5. Send a new template from OCR. ProtocolIO loads that handoff, shows the source notice, and the restored prior draft is replaced by the handoff template.
6. Corrupt or change the version of the saved draft. ProtocolIO opens using its starter template without throwing.
7. Confirm app access rules, existing routes, app launching, and handoff APIs continue to work.
