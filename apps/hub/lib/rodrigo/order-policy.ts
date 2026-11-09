/** Server checks for a Storefront enquiry. The browser does not choose the actor. */

export function orderCustomerMatches(
  payload: Record<string, unknown>,
  user: { email: string; displayName: string },
) {
  const email = user.email.trim().toLowerCase();
  return payload.status === 'requested'
    && typeof payload.customerEmail === 'string'
    && payload.customerEmail.toLowerCase() === email
    && email.length >= 3
    && payload.customerName === user.displayName
    && user.displayName.length > 0
    && typeof payload.note === 'string'
    && payload.note.length <= 2000;
}

export interface PricedCatalogProduct {
  id: string;
  active: boolean;
  currency: string;
  priceMinor: number;
}

export function catalogProductsFromResources(
  items: ReadonlyArray<{ resource: Record<string, unknown> }>,
): PricedCatalogProduct[] {
  return items.flatMap(({ resource }) => {
    if (typeof resource.id !== 'string' || typeof resource.currency !== 'string' || typeof resource.active !== 'boolean' || !Number.isSafeInteger(resource.priceMinor)) return [];
    return [{ id: resource.id, active: resource.active, currency: resource.currency, priceMinor: resource.priceMinor as number }];
  });
}

export function orderItemsMatchCatalog(items: unknown, products: readonly PricedCatalogProduct[]) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return false;
  const byId = new Map(products.map((product) => [product.id, product]));
  return items.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    const product = typeof row.productId === 'string' ? byId.get(row.productId) : undefined;
    return Boolean(
      product
      && product.active
      && product.currency === 'USD'
      && row.unitPriceMinor === product.priceMinor
      && Number.isSafeInteger(row.quantity)
      && (row.quantity as number) >= 1
      && (row.quantity as number) <= 10_000,
    );
  });
}
