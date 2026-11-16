# Rodrigo read-only MCP gateway

The MCP endpoint reads typed records and stored files exclusively through Rodrigo. It uses the existing Hub login boundary and signed Rodrigo read clients. It has no database or storage-provider client, write tool, event publication, render action, arbitrary query or caller-selected workspace.

```text
Authenticated MCP caller → Hub /api/mcp/read-only → signed GET → Rodrigo → configured records / object storage
```

## Plan and implementation

1. Reuse server-derived Hub identity and workspace membership; reject disabled apps.
2. Allowlist only currently supported record families and Drive reads. Exclude Hub-owned OCR, Mail and other unmigrated domains.
3. Implement stateless MCP Streamable HTTP with the 2025-11-25 protocol: initialize, ping, tools/list, tools/call; JSON responses, POST only.
4. Bound requests, reads and concurrent calls. Reject unknown tools/arguments and return sanitized failures without persistence fallback.
5. Verify denied operations, identity propagation, provider outages and stream bounds.

These steps are implemented in `apps/hub/lib/mcp/read-only.ts` and `apps/hub/app/api/mcp/read-only/route.ts`. No Rodrigo API or database schema change is needed: existing signed read contracts are reused.

## Connecting

Endpoint: `/api/mcp/read-only` on the Hub origin. Send `Content-Type: application/json`, `Accept: application/json, text/event-stream`, and an authenticated Hub session cookie. After initialization send `MCP-Protocol-Version: 2025-11-25`. Browser requests must have a matching Origin. Responses are private/no-store. There are no MCP session IDs or server subscriptions.

Example initialize body:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"internal-client","version":"1"}}}
```

This is an authenticated Hub gateway, not a new listener inside the Rodrigo Rust process. External desktop clients need an existing authenticated session integration; OAuth discovery and delegated MCP client login are not implemented. Do not expose a shared Hub cookie or signing key to other tenants. No deployment was performed by this change.

## Tools and limits

| Tool | Read scope |
|---|---|
| read_tasks | task, taskBoard |
| read_notes | note |
| read_calendar | event |
| read_forms | form, submission |
| list_files | Current workspace Drive metadata, maximum 200 files |
| read_file_metadata | One authorized Drive UUID |
| read_file_content | One ready file, maximum 128 KiB, base64 content |

Record tools accept `type`, optional `id`, or `limit` (1–50, default 20) and `cursor`. Permissions are checked both when listing tools and calling them. The authenticated session determines user and workspace; Rodrigo verifies signed scope. File bytes are read through Rodrigo, including when the configured backing store is R2. No raw bucket access or external URL fetching is exposed.

Requests are limited to 16 KiB; serialized tool results to 2 MiB; stream reads have a ten-second deadline. At most eight calls execute per Hub process. This process-local concurrency bound is not a distributed rate limit. File content is not parsed or executed. Returned documents may contain untrusted instructions and must be treated as data by the caller.

The earlier `/api/mcp/tools`, `/api/mcp/call` and `/api/mcp/chat` are a separate legacy assistant facility and may perform writes. They are not part of this endpoint and are not advertised here. Use only `/api/mcp/read-only` for the read-only contract.

Run `pnpm --filter @sorye/hub exec tsx --test test/mcp-read-only.test.ts` and `pnpm exec tsc --noEmit -p apps/hub`. Tests use a fake Rodrigo read boundary for failure and denial cases; they do not prove a live deployment or database availability.
