/**
 * Minimal JSX runtime that renders straight to an HTML string.
 *
 * Site components are pure functions with no state, effects or hydration, so React is
 * not needed. Rendering to a string also works inside Next.js route handlers, where
 * `react-dom/server` is refused. Files use the classic pragmas:
 *   /** @jsxRuntime classic *\/ /** @jsx h *\/ /** @jsxFrag Fragment *\/
 *
 * Every text child and attribute value is escaped. There is no raw-HTML escape hatch
 * and no event-handler attribute: `on*`, `style` and `dangerouslySetInnerHTML` are refused.
 */

/** Already-rendered, already-escaped markup. Only this module creates it. */
export class Html {
  readonly #value: string;
  constructor(value: string, token: symbol) {
    if (token !== CREATE) throw new TypeError('Html values are created by the renderer only');
    this.#value = value;
  }
  toString(): string {
    return this.#value;
  }
}
const CREATE = Symbol('html');

export type Child = Html | string | number | boolean | null | undefined | Child[];

export const Fragment = Symbol.for('sorye.site.fragment');
type Component<P> = (props: P) => Child;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ATTR: Record<string, string> = {
  className: 'class', htmlFor: 'for', tabIndex: 'tabindex', autoComplete: 'autocomplete', maxLength: 'maxlength',
  fetchPriority: 'fetchpriority', popoverTarget: 'popovertarget', popoverTargetAction: 'popovertargetaction', hrefLang: 'hreflang',
};
const NAME = /^[a-z][a-z0-9-]*$/;

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderChild(child: Child, out: string[]): void {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) { for (const c of child) renderChild(c, out); return; }
  if (child instanceof Html) { out.push(child.toString()); return; }
  out.push(escapeText(String(child)));
}

function attributes(props: Record<string, unknown>): string {
  let out = '';
  for (const [key, value] of Object.entries(props)) {
    // `__source` / `__self` are development-only props some JSX compilers add.
    if (key === 'children' || key === 'key' || key === '__source' || key === '__self' || value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') || key === 'style' || key === 'dangerouslySetInnerHTML') throw new TypeError(`Attribute ${key} is not allowed`);
    const name = ATTR[key] ?? key;
    if (!NAME.test(name)) throw new TypeError(`Invalid attribute ${key}`);
    out += value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  return out;
}

export function h(type: string | symbol | Component<Record<string, unknown>>, props: Record<string, unknown> | null, ...children: Child[]): Html {
  const all = props ?? {};
  const kids: Child = children.length === 0 ? (all.children as Child) : children.length === 1 ? children[0] : children;
  if (typeof type === 'function') {
    const result = type({ ...all, children: kids });
    return toHtml(result);
  }
  const out: string[] = [];
  if (type === Fragment) {
    renderChild(kids, out);
    return new Html(out.join(''), CREATE);
  }
  if (typeof type !== 'string' || !NAME.test(type)) throw new TypeError('Invalid element type');
  out.push(`<${type}${attributes(all)}>`);
  if (VOID.has(type)) return new Html(out.join(''), CREATE);
  renderChild(kids, out);
  out.push(`</${type}>`);
  return new Html(out.join(''), CREATE);
}

/** Renders any child (element, text, list) to an escaped HTML string. */
export function toHtml(child: Child): Html {
  const out: string[] = [];
  renderChild(child, out);
  return new Html(out.join(''), CREATE);
}

export function renderToString(child: Child): string {
  return toHtml(child).toString();
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace h {
  namespace JSX {
    type Element = Html;
    interface ElementChildrenAttribute { children: unknown }
    interface IntrinsicAttributes { key?: string | number }
    interface IntrinsicElements { [tag: string]: Record<string, unknown> }
  }
}
