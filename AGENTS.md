# Repository-wide contributor steering

These instructions apply to every change in this repository, including work performed by automated agents. Read this file first, then read [the agent guide](docs/AGENTS.md) and any app-specific guidance that applies to the files being changed.

## Keep the behavior map current

[`docs/APP-BEHAVIOR-TREE.html`](docs/APP-BEHAVIOR-TREE.html) is the locally viewable, static visual map of how Sorye behaves at runtime; [`docs/APP-BEHAVIOR-TREE.md`](docs/APP-BEHAVIOR-TREE.md) is its readable source and Markdown version. Update both in the same change whenever work changes a user-visible flow, app launch or mount path, app-to-Hub interaction, cross-app event or handoff, authentication or workspace boundary, persistence behavior, or an app's integration with another service. Add or remove app nodes when the catalog or app architecture changes.

Before editing, compare the proposed work with the behavior map and relevant source of truth. Before finishing, check that every affected edge and state owner in both formats still describes the implementation. If behavior is unchanged, no diagram edit is needed. Keep nodes at the system and user-flow level; implementation details belong in source and focused documentation.

## Repository rules

- Preserve existing worktree changes. Inspect `git status` before edits and do not revert or overwrite work that is not part of the task.
- Shared contracts and the app catalog live in `packages/types/`. Hub owns shared APIs and workspace authorization. Derive workspace identity from the server session; do not trust a client-supplied workspace ID.
- Apps do not import or call one another directly. Route shared behavior through Hub APIs, platform events, or handoffs.
- Keep app-private UI state inside its app. Persist state according to the app's existing owner and lifetime; do not move private state into global kernel signals.
- When adding or changing an app, keep `packages/types/src/apps.ts`, federation/Hub wiring, `docs/apps/APPS.md`, and the behavior tree consistent.
- Follow the security, testing, and architecture instructions in `docs/AGENTS.md`, `docs/SECURITY.md`, and `docs/ARCHITECTURE.md`.
