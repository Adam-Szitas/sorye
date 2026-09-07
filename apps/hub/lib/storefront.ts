import { randomUUID } from 'crypto';
import {
  cloneStorefrontSeedProducts,
  type PlaceStorefrontOrderInput,
  type StorefrontOrder,
  type StorefrontProduct,
  type UpsertStorefrontProductInput,
} from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';

const MAX_PRODUCTS = 50;
const MAX_ORDERS = 100;
const MAX_LINE_ITEMS = 20;
const MAX_QTY = 99;
const MAX_NOTE = 2000;
const MAX_TITLE = 120;
const MAX_SUMMARY = 240;
const MAX_DESCRIPTION = 2000;
const MAX_CATEGORY = 40;
const MAX_ACCENT = 32;
const MAX_PRICE_CENTS = 10_000_000;

type ProductStore = Record<string, StorefrontProduct[]>;
type OrderStore = Record<string, StorefrontOrder[]>;

const productsFile = jsonDataFile<ProductStore>(
  'storefront-products.json',
  () => ({}),
);
const ordersFile = jsonDataFile<OrderStore>(
  'storefront-orders.json',
  () => ({}),
);

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function cloneProduct(product: StorefrontProduct): StorefrontProduct {
  return { ...product };
}

export async function listStorefrontProducts(
  workspaceId: string,
): Promise<StorefrontProduct[]> {
  const snapshot = await productsFile.read();
  const existing = snapshot[workspaceId];
  if (existing && existing.length > 0) {
    return existing.map(cloneProduct);
  }
  return productsFile.update((store) => {
    if (store[workspaceId]?.length) {
      return store[workspaceId]!.map(cloneProduct);
    }
    const seeded = cloneStorefrontSeedProducts();
    store[workspaceId] = seeded;
    return seeded.map(cloneProduct);
  });
}

/** Public site cards — names/prices only. Does not persist seed or expose orders. */
export async function listPublicStorefrontProducts(
  workspaceId: string,
): Promise<StorefrontProduct[]> {
  const snapshot = await productsFile.read();
  const existing = snapshot[workspaceId];
  if (existing && existing.length > 0) {
    return existing.map(cloneProduct);
  }
  return cloneStorefrontSeedProducts();
}

export async function upsertStorefrontProduct(
  workspaceId: string,
  input: UpsertStorefrontProductInput,
): Promise<StorefrontProduct> {
  const title = clip(input.title, MAX_TITLE);
  if (!title) {
    throw new Error('Title is required');
  }

  const priceCents = Number(input.priceCents);
  if (
    !Number.isInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > MAX_PRICE_CENTS
  ) {
    throw new Error('priceCents must be an integer from 0 to 10000000');
  }

  const next: StorefrontProduct = {
    id: '',
    title,
    summary: clip(input.summary ?? '', MAX_SUMMARY) || title,
    description: clip(input.description ?? '', MAX_DESCRIPTION) || title,
    priceCents,
    category: clip(input.category ?? 'General', MAX_CATEGORY) || 'General',
    accent: clip(input.accent ?? '#f472b6', MAX_ACCENT) || '#f472b6',
  };

  return productsFile.update((store) => {
    const list = store[workspaceId] ?? cloneStorefrontSeedProducts();
    const requestedId =
      typeof input.id === 'string' ? clip(input.id, 64) : '';
    const idx = requestedId
      ? list.findIndex((product) => product.id === requestedId)
      : -1;

    if (idx >= 0) {
      next.id = requestedId;
      list[idx] = next;
    } else {
      if (list.length >= MAX_PRODUCTS) {
        throw new Error(`Catalog is limited to ${MAX_PRODUCTS} products`);
      }
      next.id = requestedId || `sf-${randomUUID().slice(0, 10)}`;
      if (list.some((product) => product.id === next.id)) {
        throw new Error('Product id already exists');
      }
      list.push(next);
    }

    store[workspaceId] = list;
    return cloneProduct(next);
  });
}

export async function listStorefrontOrders(
  workspaceId: string,
  opts?: { userId?: string },
): Promise<StorefrontOrder[]> {
  const store = await ordersFile.read();
  let list = store[workspaceId] ?? [];
  if (opts?.userId) {
    list = list.filter((order) => order.userId === opts.userId);
  }
  return list.map((order) => ({
    ...order,
    items: order.items.map((item) => ({ ...item })),
  }));
}

export async function placeStorefrontOrder(input: {
  workspaceId: string;
  userId: string;
  userName: string;
  body: PlaceStorefrontOrderInput;
}): Promise<StorefrontOrder> {
  const note = clip(input.body.note ?? '', MAX_NOTE);
  const rawItems = Array.isArray(input.body.items) ? input.body.items : [];
  if (rawItems.length === 0) {
    throw new Error('Cart is empty');
  }
  if (rawItems.length > MAX_LINE_ITEMS) {
    throw new Error(`Orders are limited to ${MAX_LINE_ITEMS} line items`);
  }

  const products = await listStorefrontProducts(input.workspaceId);
  const byId = new Map(products.map((product) => [product.id, product]));
  const merged = new Map<string, number>();

  for (const line of rawItems) {
    if (!line || typeof line.productId !== 'string') {
      throw new Error('Each item needs a productId');
    }
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new Error(`Quantity must be an integer from 1 to ${MAX_QTY}`);
    }
    if (!byId.has(line.productId)) {
      throw new Error('Unknown product in cart');
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + qty);
  }

  const items = [...merged.entries()].map(([productId, quantity]) => {
    const product = byId.get(productId)!;
    return {
      productId,
      title: product.title,
      quantity,
      unitPriceCents: product.priceCents,
    };
  });

  const totalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );

  const order: StorefrontOrder = {
    id: `sfo-${randomUUID().slice(0, 12)}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    userName: clip(input.userName, 80) || 'Workspace member',
    status: 'enquiry',
    items,
    note,
    totalCents,
    createdAt: new Date().toISOString(),
  };

  await ordersFile.update((store) => {
    const list = store[input.workspaceId] ?? [];
    list.unshift(order);
    store[input.workspaceId] = list.slice(0, MAX_ORDERS);
  });

  return {
    ...order,
    items: order.items.map((item) => ({ ...item })),
  };
}
