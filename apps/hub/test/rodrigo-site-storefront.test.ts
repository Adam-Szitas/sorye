import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionBatchSchema } from '../lib/rodrigo/action-validation';
import { orderCustomerMatches, orderItemsMatchCatalog } from '../lib/rodrigo/order-policy';
import { projectPublishedSite } from '../lib/site';

const occurredAt = '2026-11-09T12:00:00.000Z';

function action(appId: string, resourceType: string, resourceId: string, payload: Record<string, unknown>) {
  return { actionId: 'e1055eb9-cdd7-4942-9a91-5ad3e609ca92', appId, resourceType, operation: 'create', resourceId, payloadVersion: 1, payload, occurredAt };
}

test('Site action payload maps block type to the Rodrigo page contract', () => {
  const site = action('site', 'page', 'workspace-1', {
    id: 'workspace-1', slug: 'example-workspace', title: 'Example', published: false,
    blocks: [{ id: 'hero-1', kind: 'hero', content: { heading: 'Hi' } }, { id: 'shop-1', kind: 'shop', content: { heading: 'Products' } }],
    updatedAt: occurredAt,
  });
  assert.equal(actionBatchSchema.safeParse({ actions: [site] }).success, true);
  const invalid = { ...site, payload: { ...(site.payload as object), blocks: [{ id: 'shop-1', kind: 'storefront', content: {} }] } };
  assert.equal(actionBatchSchema.safeParse({ actions: [invalid] }).success, false);
});

test('Storefront product action preserves app card fields and rejects price disagreement', () => {
  const product = action('storefront', 'product', 'sf-one', {
    id: 'sf-one', name: 'Protocol pack', title: 'Protocol pack', summary: 'Templates', description: 'PDF templates',
    currency: 'USD', priceMinor: 8900, priceCents: 8900, category: 'Documents', accent: '#a78bfa', active: true, updatedAt: occurredAt,
  });
  assert.equal(actionBatchSchema.safeParse({ actions: [product] }).success, true);
  const invalid = { ...product, payload: { ...(product.payload as object), priceCents: 8901 } };
  assert.equal(actionBatchSchema.safeParse({ actions: [invalid] }).success, false);
});

test('Storefront order create keeps the note and binds the verified customer', () => {
  const order = action('storefront', 'order', 'ord-1', {
    id: 'ord-1', status: 'requested', customerName: 'Ada Lovelace', customerEmail: 'ada@example.test',
    items: [{ productId: 'sf-one', quantity: 2, unitPriceMinor: 8900 }], note: 'Dock delivery',
    createdAt: occurredAt, updatedAt: occurredAt,
  });
  assert.equal(actionBatchSchema.safeParse({ actions: [order] }).success, true);
  const accepted = { ...order, payload: { ...(order.payload as object), status: 'accepted' } };
  assert.equal(actionBatchSchema.safeParse({ actions: [accepted] }).success, false);
  const buyer = { email: 'Ada@Example.test', displayName: 'Ada Lovelace' };
  assert.equal(orderCustomerMatches(order.payload, buyer), true);
  assert.equal(orderCustomerMatches({ ...order.payload, customerName: 'Other' }, buyer), false);
  assert.equal(orderItemsMatchCatalog(order.payload.items, [{ id: 'sf-one', active: true, currency: 'USD', priceMinor: 8900 }]), true);
  assert.equal(orderItemsMatchCatalog(order.payload.items, [{ id: 'sf-one', active: true, currency: 'USD', priceMinor: 1 }]), false);
});

test('Published Site projection drops unsafe links and omits the workspace', () => {
  const page = projectPublishedSite({
    slug: 'example-workspace', title: 'Example',
    blocks: [{ id: 'hero-1', kind: 'hero', content: { heading: 'Hi', offer: '', ctaLabel: 'Contact', ctaHref: '/contact' } }],
    products: [],
  });
  assert.equal(page?.slug, 'example-workspace');
  assert.equal(page?.displayName, 'Example');
  assert.equal('workspaceId' in (page ?? {}), false);
  const unsafe = projectPublishedSite({
    slug: 'example-workspace', title: 'Example',
    blocks: [{ id: 'hero-1', kind: 'hero', content: { heading: 'Hi', offer: '', ctaLabel: 'Go', ctaHref: 'javascript:alert(1)' } }],
    products: [],
  });
  assert.equal(unsafe, null);
});
