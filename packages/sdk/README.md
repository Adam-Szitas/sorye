# @sorye/sdk

Lightweight Lit web components shared across the Sorye platform (hub, micro-frontends, future apps).

## Design goals

- **Native-close** — standards-based custom elements, work in any framework
- **Minimal repaints** — CSS `contain`, `content-visibility`, GPU-friendly transitions
- **No re-render on typing** — `sorye-input` keeps value in the native DOM (uncontrolled)
- **Shadow DOM** — style encapsulation without leaking into host apps
- **Design tokens** — CSS custom properties pierce shadow boundaries from `:root`

## Components

| Element | Purpose |
|---------|---------|
| `<sorye-button>` | Primary actions — variants, sizes, loading |
| `<sorye-badge>` | Status pills with optional dot |
| `<sorye-card>` | Slot-based layout (header / body / footer) |
| `<sorye-input>` | Labelled native input with hint/error |
| `<sorye-spinner>` | CSS-only loading indicator |
| `<sorye-icon>` | Inline SVG icons (no icon font) |
| `<sorye-divider>` | Horizontal / vertical separator |

## Usage

### Register once (any app)

```ts
import '@sorye/sdk/tokens.css';
import '@sorye/sdk/register';
```

```html
<sorye-button variant="primary">Save</sorye-button>
<sorye-badge variant="accent" dot>Pro</sorye-badge>
```

### React / Next.js (hub)

```tsx
import '@sorye/sdk/register';
import { Button, Badge, Input } from '@sorye/sdk/react';

<Button variant="primary" loading={saving}>Save</Button>
<Input
  label="API key"
  onSoryeInput={(e) => setKey(e.detail.value)}
/>
```

## Performance notes

- **`:host { contain: layout style }`** on every component — repaints stay scoped
- **Badge / Card / Spinner** use `contain: strict` or `content-visibility: auto`
- **Button** animates `transform` + `opacity` only (compositor-friendly)
- **Input** does not store keystrokes in Lit `@state` — zero Lit updates per keypress
- **`reflect: true`** used only where needed for CSS attribute selectors
- **`prefers-reduced-motion`** disables spin animations

## Dev playground

```bash
pnpm --filter @sorye/sdk dev
```

Open http://localhost:3002

## Build

```bash
pnpm --filter @sorye/sdk build
```

## Workspace uploads

Use `uploadToDrive(file, sourceAppId)` from `@sorye/sdk/files` before processing a user upload. It returns the stored file id and saves the original in the app's Drive folder. Pass a third argument for a standalone app's Hub `/api/files` URL. Upload failures must be shown to the user. Existing Drive files should be reused by id, never uploaded again.

Drive folders are metadata keyed by catalog app id and displayed using the app's current name. Files without a source remain in Drive. Original bytes retain stable ids across renames. `POST /api/files/:id/open` with `{ targetAppId }` validates workspace access and MIME compatibility, then delivers a `workspace-file` handoff through Relay and returns the destination URL. Explicit app handoffs work independently of optional Messenger notification settings. OCR resolves the handoff's file id against authenticated Drive storage; Qwen accepts `fileId` instead of another upload.

## React document readers

Import `DocumentTranscript` and `JsonDocument` from `@sorye/sdk/react/document-reading`.
`DocumentTranscript` accepts `pages: { page: number; rows: string[] }[]`, retaining line order and whitespace.
`JsonDocument` accepts `value`, `fileName`, and an optional `label`; its accessible disclosure shows the complete JSON with copy and download actions. Pass a content-only projection, not internal storage records. Both components include scoped styles and support document color overrides through `--document-surface`, `--document-text`, `--document-border`, and `--document-muted-surface`.
