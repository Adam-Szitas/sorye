import type { FrameLocator, Locator, Page } from '@playwright/test';

export type RoleName = Parameters<Page['getByRole']>[0];

/**
 * One query, stored as data. `loc()` uses the first strategy that is set:
 * **role** → **label** → **placeholder** → **text** → **css**.
 *
 * Prefer `role` / `label` (Playwright accessible locators). Keep `css` as a
 * fallback you can promote by removing the role/label/text fields.
 */
export type LocatorSpec = {
  role?: RoleName;
  name?: string | RegExp;
  exact?: boolean;
  label?: string | RegExp;
  placeholder?: string | RegExp;
  text?: string | RegExp;
  css?: string;
};

export type QueryRoot = Page | FrameLocator | Locator;

export function loc(root: QueryRoot, spec: LocatorSpec): Locator {
  if (spec.role) {
    return root.getByRole(spec.role, {
      name: spec.name,
      exact: spec.exact,
    });
  }
  if (spec.label) {
    return root.getByLabel(spec.label, { exact: spec.exact });
  }
  if (spec.placeholder) {
    return root.getByPlaceholder(spec.placeholder);
  }
  if (spec.text) {
    return root.getByText(spec.text, { exact: spec.exact });
  }
  if (spec.css) {
    return root.locator(spec.css);
  }
  throw new Error('LocatorSpec needs role, name, label, placeholder, text, or css');
}
