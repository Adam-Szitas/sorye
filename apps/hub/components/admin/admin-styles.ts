/** Console styles. Scoped under `.admin-root`; tokens come from the Hub theme. */
export const ADMIN_CONSOLE_CSS = `
.admin-root { min-block-size: 100dvh; block-size: auto; }
.admin-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-block-size: 0;
}
@media (min-width: 64rem) {
  .admin-layout { grid-template-columns: 15rem minmax(0, 1fr); }
}
.admin-nav { border-block-end: 1px solid var(--color-border); background: var(--color-surface-raised); }
@media (min-width: 64rem) {
  .admin-nav { border-block-end: 0; border-inline-end: 1px solid var(--color-border); }
  .admin-nav ul { position: sticky; inset-block-start: 4.5rem; flex-direction: column; }
}
.admin-nav ul { display: flex; gap: 0.25rem; overflow-x: auto; padding: 0.75rem; margin: 0; list-style: none; }
.admin-nav a {
  display: block; white-space: nowrap; border-radius: 0.5rem; padding: 0.5rem 0.75rem;
  color: var(--color-text-muted); text-decoration: none; font-size: 0.875rem;
}
.admin-nav a:hover { background: var(--color-surface-overlay); color: var(--color-text); }
.admin-nav a[aria-current="page"] { background: var(--color-surface-overlay); color: var(--color-text); font-weight: 600; }
.admin-main { min-inline-size: 0; overflow: visible; }
.admin-root :focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
.admin-user { font-size: 0.75rem; color: #94a3b8; max-inline-size: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-bar-button {
  border-radius: 0.5rem; padding: 0.375rem 0.75rem; font-size: 0.75rem; color: #94a3b8;
  background: transparent; border: 1px solid rgba(255,255,255,0.1); cursor: pointer;
}
.admin-bar-button:hover { background: rgba(255,255,255,0.1); color: #f1f5f9; }
.admin-page { display: flex; flex-direction: column; gap: 2rem; padding: 1.5rem; max-inline-size: 90rem; }
.admin-page h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
.admin-page h2 { font-size: 1.125rem; font-weight: 600; margin: 0; }
.admin-lede { margin-block-start: 0.25rem; max-inline-size: 48rem; font-size: 0.875rem; color: var(--color-text-muted); }
.admin-muted { font-size: 0.875rem; color: var(--color-text-muted); }
.admin-section { display: flex; flex-direction: column; gap: 0.75rem; }
.admin-cards { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); margin: 0; }
.admin-card { border: 1px solid var(--color-border); background: var(--color-surface-raised); border-radius: 1rem; padding: 1rem; min-inline-size: 0; }
.admin-card dt { font-size: 0.8125rem; color: var(--color-text-muted); }
.admin-card dd { margin: 0.25rem 0 0; font-weight: 500; overflow-wrap: anywhere; }
.admin-badge {
  display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px; padding: 0.1rem 0.6rem;
  font-size: 0.75rem; font-weight: 600; border: 1px solid currentColor; white-space: nowrap;
}
.admin-badge[data-tone="ok"] { color: #34d399; }
.admin-badge[data-tone="warn"] { color: #fbbf24; }
.admin-badge[data-tone="bad"] { color: #f87171; }
.admin-badge[data-tone="info"] { color: #94a3b8; }
.admin-alert { border-radius: 0.75rem; padding: 0.75rem 1rem; font-size: 0.875rem; border: 1px solid var(--color-border); background: var(--color-surface-overlay); }
.admin-alert[data-tone="bad"] { border-color: rgba(248,113,113,0.5); }
.admin-alert[data-tone="warn"] { border-color: rgba(251,191,36,0.5); }
.admin-scroll {
  overflow: auto; max-inline-size: 100%; max-block-size: min(36rem, 75vh);
  container-type: inline-size; border: 1px solid var(--color-border); border-radius: 0.75rem;
}
.admin-table { border-collapse: separate; border-spacing: 0; inline-size: 100%; font-size: 0.875rem; }
.admin-table caption { text-align: start; font-weight: 600; padding: 0.75rem; }
.admin-table th, .admin-table td { padding: 0.55rem 0.75rem; text-align: start; vertical-align: top; border-block-end: 1px solid var(--color-border); }
.admin-table thead { position: sticky; inset-block-start: 0; z-index: 1; background: var(--color-surface-raised); }
.admin-table tbody th { font-weight: 600; }
@container (width < 44rem) {
  .admin-table, .admin-table thead, .admin-table tbody, .admin-table tr, .admin-table th, .admin-table td { display: block; }
  .admin-table thead { display: none; }
  .admin-table tr { margin: 0.5rem; border: 1px solid var(--color-border); border-radius: 0.5rem; }
  .admin-table td[data-label]::before { content: attr(data-label) ": "; font-weight: 600; }
}
.admin-form { display: flex; flex-direction: column; gap: 1rem; max-inline-size: 44rem; }
.admin-form fieldset { border: 1px solid var(--color-border); border-radius: 0.75rem; padding: 1rem; margin: 0; display: grid; gap: 1rem; }
.admin-form legend { padding-inline: 0.25rem; font-weight: 600; }
.admin-grid-2 { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.admin-field { display: flex; flex-direction: column; gap: 0.35rem; }
.admin-field label { font-size: 0.875rem; font-weight: 500; }
.admin-hint { font-size: 0.8125rem; color: var(--color-text-muted); }
.admin-error { font-size: 0.8125rem; color: #fca5a5; }
.admin-root input:not([type="checkbox"]):not([type="radio"]), .admin-root select, .admin-root textarea {
  font-size: 1rem; line-height: 1.4; border: 1px solid var(--color-border); background: var(--color-surface-overlay);
  color: var(--color-text); border-radius: 0.6rem; padding: 0.5rem 0.65rem; min-block-size: 2.75rem;
}
.admin-root input:user-invalid, .admin-root select:user-invalid, .admin-root [aria-invalid="true"] { border-color: #f87171; }
.admin-button {
  min-block-size: 2.75rem; padding-inline: 1rem; border-radius: 0.6rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--color-border); background: var(--color-surface-overlay); color: var(--color-text);
}
.admin-button[data-variant="primary"] { background: var(--color-accent); color: var(--color-surface); border-color: transparent; }
.admin-button[data-variant="danger"] { border-color: rgba(248,113,113,0.6); color: #fca5a5; }
.admin-button:disabled { opacity: 0.6; cursor: progress; }
.admin-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.admin-details summary { cursor: pointer; font-size: 0.875rem; color: var(--color-text-muted); }
.admin-details pre { overflow: auto; max-block-size: 20rem; font-size: 0.75rem; padding: 0.75rem; background: var(--color-surface-overlay); border-radius: 0.5rem; }
.admin-defer { content-visibility: auto; contain-intrinsic-size: auto 30rem; }
`;
