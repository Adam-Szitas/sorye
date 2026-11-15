# Drive public sharing contract

Implementation design: workspace members may create links and manage only links they created. Anyone holding a link can read its file or folder subtree anonymously. Folder `read_write` additionally permits uploading new Drive files and creating folders, never replacing, renaming, moving or deleting. File links are read-only; the API refuses `read_write` for a file rather than implying an unsupported editing operation. Duplicate display names remain separate immutable file IDs. Empty folders are visible.

Expiry defaults to seven days; creation and renewal allow at most 30 days from database time. Revocation is irreversible. Settings updates use an expected revision. A creation ID is idempotent for identical settings/token hash; the raw 256-bit token is generated in Hub and returned once, never stored. Lost responses require revoking the visible record and creating another link.

Only workspace Drive metadata is supported (default S3 and configured own Drive/database byte providers). Relay connections are refused. Folder writes use the captured storage target and stop when that target changes. Existing file reads retain their original provider. No fallback occurs on provider failure.

Every public operation uses a reserved, method/path/body-bound Hub assertion carrying the token hash. Rodrigo resolves the grant and checks expiry, revocation, live creator membership, root existence and subtree containment. Public upload ownership is a share-specific actor; it cannot resume another upload. Authorization is not cached. Operations already admitted may finish after revocation; subsequent operations fail, including upload completion. Downloads already received cannot be recalled.

Tokens travel in URL fragments and Authorization headers, never request URLs. The recipient removes the fragment immediately and retains the token in memory only; reopening the original link restores access after reload. Public responses are no-store, no-referrer, noindex and nosniff. Downloads are attachments. No password option. Share management and public operations are bounded and audited without tokens/content. Public uploads reuse Hub executable sniffing and Rodrigo file/byte quotas and part admission limits.

Verification status: implementation in progress; not yet accepted for release.
