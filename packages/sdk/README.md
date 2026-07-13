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
