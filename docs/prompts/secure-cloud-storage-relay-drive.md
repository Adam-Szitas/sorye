# Prompt: Secure cloud storage through Relay and Drive

Extend Relay and Drive so an authorized workspace administrator can connect, manage, and use cloud storage through the existing Hub APIs.

## Product behavior

- Relay has a clear **Connected storage** section and a **Connect storage** action.
- Support named AWS S3 and Cloudflare R2 connections through a server-side S3 adapter. Do not accept arbitrary endpoint URLs.
- Connection setup asks for a friendly name, provider-specific location details, and credentials; validates credentials before saving; explains required permissions in plain language.
- Drive shows each connected storage as a folder using its friendly name. Users can browse, upload, and download objects there. Local Drive behavior remains available.
- Provide clear loading, empty, permission, connection, and network error states. Never silently claim an upload succeeded if the provider rejected it.

## Security requirements

- Derive workspace identity from `ensureHubUser()` on every request. Enforce workspace scoping on all storage IDs and object operations.
- Restrict setup, deletion, secret reveal, and credential rotation to authenticated Sorye admins (`session.user.isAdmin`). Ordinary workspace members may browse/upload/download if the connection is enabled.
- Encrypt credentials at rest using AES-256-GCM and a dedicated server-only `STORAGE_SECRET_KEY`. Never store credentials in browser storage, Relay config, logs, metrics, URLs, or ordinary API responses.
- The normal listing returns safe metadata and secret presence only. Support explicit, admin-only secret reveal because the product requires it; require a deliberate reveal action, rate-limit it, and return `Cache-Control: no-store`. Never reveal secrets during normal page loading.
- Do not log request bodies or provider errors that could contain credentials. Sanitize errors before returning them.
- Use only fixed provider endpoint construction (AWS regional S3 and Cloudflare account R2). Do not allow user-supplied endpoints or redirects. Validate bucket, region, account ID, names, file sizes, MIME/disposition, object keys, and provider response sizes.
- Use least-privilege IAM instructions, encrypt secrets in storage, support rotation and deletion, and avoid broad bucket listing permissions where possible.
- Follow existing Hub patterns: `ensureHubUser`, workspace-scoped Hub routes, Relay client API helpers, Hub-native Drive, and server-side file/storage logic. Do not add app-to-app imports or trust client-provided workspace IDs.

## Architecture references

- `docs/AGENTS.md`
- `docs/ARCHITECTURE.md` (Hub API and storage boundaries)
- `apps/hub/lib/storage-crypto.ts`
- `apps/hub/lib/relay.ts`
- `apps/hub/app/api/relay/route.ts`
- `apps/relay/src/relay-config.tsx`
- `apps/relay/src/relay-storage.ts`
- `apps/hub/components/app-files.tsx`

Implement the feature in stages with a provider adapter and safe public types. Preserve unrelated working-tree changes. Review auth, workspace isolation, secret redaction/encryption, input validation, and provider operations against the requirements. Run relevant typechecks/build validation.
