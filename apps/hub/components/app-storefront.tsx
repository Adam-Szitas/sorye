'use client';
import { switchAuthorizedWorkspace } from '@sorye/platform';
import { createDurableActionQueue, registerPendingActionFlusher, type DurableActionQueue } from '@sorye/platform';
import { TranslatedText, UserLoadSections } from '@sorye/platform/react';


import {
  formatStorefrontPrice,
  type StorefrontOrder,
  type StorefrontProduct,
  type UserLoadPartition,
  type UserLoadWorkspace,
} from '@sorye/types';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';

type Tab = 'shop' | 'cart' | 'orders';

type StorefrontAction = { actionId: string; appId: 'storefront'; resourceType: 'product' | 'order'; operation: 'create' | 'update'; resourceId: string; expectedRevision?: number; payloadVersion: 1; payload: Record<string, unknown>; occurredAt: string };
type ProductDraft = { id?: string; title: string; summary: string; description: string; priceCents: string; category: string; accent: string };

interface CartLine {
  productId: string;
  quantity: number;
}

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

function cartStorageKey(workspaceId: string) {
  return `sorye:storefront:cart:${workspaceId}`;
}

function readCart(workspaceId: string): CartLine[] {
  try {
    const raw = sessionStorage.getItem(cartStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is CartLine =>
        Boolean(line) &&
        typeof line.productId === 'string' &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0,
    );
  } catch {
    return [];
  }
}

function writeCart(workspaceId: string, lines: CartLine[]) {
  try {
    sessionStorage.setItem(cartStorageKey(workspaceId), JSON.stringify(lines));
  } catch {
    // Ignore quota / private mode.
  }
}

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, Math.floor(n)));
}

export function AppStorefront() {
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [products, setProducts] = useState<StorefrontProduct[] | null>(null);
  const [orders, setOrders] = useState<StorefrontOrder[]>([]);
  const [orderLoad, setOrderLoad] = useState<UserLoadPartition<StorefrontOrder> | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tab, setTab] = useState<Tab>('shop');
  const [selected, setSelected] = useState<StorefrontProduct | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [canManageProducts, setCanManageProducts] = useState(false);
  const [buyer, setBuyer] = useState<{ email: string; displayName: string } | null>(null);
  const [productRevisions, setProductRevisions] = useState<Record<string, number>>({});
  const [productQueueScope, setProductQueueScope] = useState<string | null>(null);
  const [productPending, setProductPending] = useState(0);
  const [productSaving, setProductSaving] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const productQueue = useRef<DurableActionQueue<StorefrontAction> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const flushBestEffort = async () => {
      await flushProductActions().catch(() => undefined);
      return (await productQueue.current?.list())?.length ?? 0;
    };
    const unregister = registerPendingActionFlusher('storefront', flushBestEffort);
    window.addEventListener('pagehide', flushBestEffort);
    window.addEventListener('sorye:logout-flush', flushBestEffort);
    return () => {
      window.removeEventListener('pagehide', flushBestEffort);
      window.removeEventListener('sorye:logout-flush', flushBestEffort);
      unregister();
    };
  }, [productQueueScope]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.setAttribute('closedby', 'any');
    if (selected) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [mounted, selected]);

  const persistCart = useCallback((workspace: string, lines: CartLine[]) => {
    setCart(lines);
    writeCart(workspace, lines);
  }, []);

  const loadOrders = useCallback(async () => {
    const res = await fetch('/api/storefront/orders?mine=1', {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      orders?: StorefrontOrder[];
      load?: UserLoadPartition<StorefrontOrder>;
    };
    setOrders(data.orders ?? []);
    setOrderLoad(data.load ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sessionRes, productsRes] = await Promise.all([
          fetch('/api/workspace', { credentials: 'include' }),
          fetch('/api/storefront/products', { credentials: 'include' }),
        ]);
        if (!sessionRes.ok || !productsRes.ok) {
          if (!cancelled) setError('Could not load Storefront for this workspace.');
          return;
        }
        const session = (await sessionRes.json()) as {
          user?: { id?: string; email?: string; displayName?: string };
          workspace?: { id?: string };
        };
        const catalog = (await productsRes.json()) as {
          products?: StorefrontProduct[];
          queueScope?: string;
          canManage?: boolean;
          revisions?: Record<string, number>;
        };
        const ws = session.workspace?.id;
        if (!ws || cancelled) return;
        setWorkspaceId(ws);
        setUserId(session.user?.id ?? null);
        setBuyer(session.user?.email && session.user.displayName ? { email: session.user.email, displayName: session.user.displayName } : null);
        setProducts(catalog.products ?? []);
        setCanManageProducts(catalog.canManage === true);
        setProductRevisions(catalog.revisions ?? {});
        setProductQueueScope(catalog.queueScope ?? null);
        if (catalog.queueScope) {
          productQueue.current?.close();
          productQueue.current = createDurableActionQueue<StorefrontAction>({ appId: 'storefront', scope: catalog.queueScope });
          setProductPending((await productQueue.current.list()).length);
        }
        setCart(readCart(ws));
        await loadOrders();
      } catch {
        if (!cancelled) setError('Could not load Storefront for this workspace.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrders]);

  useEffect(() => {
    if (!productQueueScope || !productQueue.current) return;
    void flushProductActions().then(async () => {
      setProductPending((await productQueue.current?.list())?.length ?? 0);
    }).catch(() => undefined);
  }, [productQueueScope]);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => {
    const product = productById.get(line.productId);
    return sum + (product ? product.priceCents * line.quantity : 0);
  }, 0);

  function addToCart(product: StorefrontProduct, quantity: number) {
    if (!workspaceId) return;
    const qty = clampQty(quantity);
    const next = [...cart];
    const idx = next.findIndex((line) => line.productId === product.id);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx]!,
        quantity: clampQty(next[idx]!.quantity + qty),
      };
    } else {
      next.push({ productId: product.id, quantity: qty });
    }
    persistCart(workspaceId, next);
    setNotice(`Added ${product.title} to cart`);
    closeDialog();
  }

  function setLineQty(productId: string, quantity: number) {
    if (!workspaceId) return;
    persistCart(
      workspaceId,
      cart
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: clampQty(quantity) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    if (!workspaceId) return;
    persistCart(
      workspaceId,
      cart.filter((line) => line.productId !== productId),
    );
  }

  function openProduct(product: StorefrontProduct) {
    setSelected(product);
    setDetailQty(1);
  }

  function editProduct(product?: StorefrontProduct) {
    setProductDraft(product ? { id: product.id, title: product.title, summary: product.summary, description: product.description, priceCents: String(product.priceCents), category: product.category, accent: product.accent } : { title: '', summary: '', description: '', priceCents: '0', category: 'General', accent: '#f472b6' });
  }

  async function flushProductActions() {
    const q = productQueue.current;
    if (!q) return;
    for (const row of await q.list()) {
      if (row.status !== 'pending' && row.status !== 'failed') continue;
      await q.markAttempt(row.action.actionId);
      try {
        const response = await fetch('/api/backend/actions/batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Sorye-Queue-Scope': productQueueScope ?? '' }, body: JSON.stringify({ actions: [row.action] }) });
        const data = await response.json().catch(() => ({})) as { results?: Array<{ actionId: string; status: 'committed' | 'duplicate' | 'conflict' | 'rejected'; revision?: number; error?: { code: string; message?: string } }>; error?: { code?: string } };
        if (!response.ok) { await q.markTransportFailure(row.action.actionId, { code: data.error?.code ?? 'request_failed' }); continue; }
        const result = data.results?.find((item) => item.actionId === row.action.actionId);
        if (!result) { await q.markTransportFailure(row.action.actionId, { code: 'missing_action_result' }); continue; }
        await q.settle(result);
        if ((result.status === 'committed' || result.status === 'duplicate') && row.action.resourceType === 'product') setProductRevisions((current) => ({ ...current, [row.action.resourceId]: result.revision ?? current[row.action.resourceId] ?? 0 }));
        else if (result.status !== 'committed' && result.status !== 'duplicate') setError(result.status === 'conflict' ? 'This Storefront change conflicted. Reload and reconcile before saving.' : result.error?.message ?? result.error?.code ?? 'Rodrigo rejected this Storefront change.');
      } catch {
        await q.markTransportFailure(row.action.actionId, { code: 'network_error', message: 'Rodrigo could not confirm this product change.' });
      }
    }
    const remaining = await q.list();
    setProductPending(remaining.length);
    if (remaining.length === 0) {
      try {
        const response = await fetch('/api/storefront/products', { credentials: 'include' });
        if (response.ok) setProducts(((await response.json()) as { products?: StorefrontProduct[] }).products ?? []);
      } catch { /* The durable acknowledgement is recorded; reload reconciles from Rodrigo. */ }
    }
  }

  async function reconcileProductActions() {
    const q = productQueue.current;
    if (!q) return;
    for (const row of await q.list()) if (row.status === 'conflict' || row.status === 'rejected') await q.discard(row.action.actionId);
    setProductPending((await q.list()).length);
    const response = await fetch('/api/storefront/products', { credentials: 'include' });
    if (response.ok) {
      const data = await response.json() as { products?: StorefrontProduct[]; revisions?: Record<string, number> };
      setProducts(data.products ?? []);
      setProductRevisions(data.revisions ?? {});
      setError(null);
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft || !productQueueScope || !productQueue.current || !canManageProducts || productSaving) return;
    const priceCents = Number(productDraft.priceCents);
    if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 10_000_000) { setError('Price must be between 0 and 10,000,000 cents.'); return; }
    const id = productDraft.id ?? `sf-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const action: StorefrontAction = { actionId: crypto.randomUUID(), appId: 'storefront', resourceType: 'product', operation: productDraft.id ? 'update' : 'create', resourceId: id, ...(productDraft.id ? { expectedRevision: productRevisions[id] } : {}), payloadVersion: 1, occurredAt: now,
      payload: { id, name: productDraft.title, title: productDraft.title, summary: productDraft.summary, description: productDraft.description, currency: 'USD', priceMinor: priceCents, priceCents, category: productDraft.category, accent: productDraft.accent, active: true, updatedAt: now } };
    if (productDraft.id && !action.expectedRevision) { setError('Product revision is missing. Reload the catalog before editing.'); return; }
    setProductSaving(true);
    setError(null);
    try {
      await productQueue.current.enqueue(action);
      setProductPending((await productQueue.current.list()).length);
      await flushProductActions();
      if ((await productQueue.current.list()).every((row) => row.action.actionId !== action.actionId)) setProductDraft(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save this product.');
    } finally { setProductSaving(false); }
  }

  function closeDialog() {
    dialogRef.current?.close();
    setSelected(null);
  }

  function onBackdropClick(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
      setSelected(null);
    }
  }

  async function onPlaceOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || cart.length === 0 || placing) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!buyer || !productQueue.current || !productQueueScope) {
      setError('Your signed-in name and email are required before an enquiry can be queued.');
      return;
    }
    if (cart.some((line) => !productRevisions[line.productId] || !productById.get(line.productId))) {
      setError('This cart includes a display-only kit. Save it as a workspace product before requesting it.');
      return;
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const action: StorefrontAction = {
      actionId: crypto.randomUUID(), appId: 'storefront', resourceType: 'order', operation: 'create', resourceId: id, payloadVersion: 1, occurredAt: now,
      payload: {
        id, status: 'requested', customerName: buyer.displayName, customerEmail: buyer.email, note,
        items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPriceMinor: productById.get(line.productId)!.priceCents })),
        createdAt: now, updatedAt: now,
      },
    };
    setPlacing(true);
    setError(null);
    try {
      await productQueue.current.enqueue(action);
      setProductPending((await productQueue.current.list()).length);
      await flushProductActions();
      const remaining = await productQueue.current.list();
      const row = remaining.find((item) => item.action.actionId === action.actionId);
      if (!row) {
        persistCart(workspaceId, []);
        setNote('');
        setNotice('Order request saved for this workspace — no payment taken.');
        await loadOrders();
        setTab('orders');
      } else if (row.status === 'pending' || row.status === 'failed') {
        setError('The order request is still pending. Use Resend when Rodrigo is reachable. The cart stays on this device.');
      } else {
        setError('Rodrigo did not accept this order request. Reload the catalog and try again. The cart stays on this device.');
      }
    } catch {
      setError('Could not place the order request.');
    } finally {
      setPlacing(false);
    }
  }

  const dialog = mounted ? (
      <dialog
        ref={dialogRef}
        className="w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/60"
        aria-labelledby={`${uid}-product-title`}
        onClick={onBackdropClick}
        onClose={() => setSelected(null)}
      >
        {selected ? (
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {selected.category}
              </p>
              <h2
                id={`${uid}-product-title`}
                className="text-base font-semibold"
              >
                {selected.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-accent)]">
                {formatStorefrontPrice(selected.priceCents)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
              onClick={closeDialog}
            >
              <TranslatedText message="close" />
            </button>
          </div>
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            {selected.description}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-medium text-[var(--color-text-muted)]">
              Quantity
              <input
                type="number"
                min={1}
                max={99}
                value={detailQty}
                onChange={(e) => setDetailQty(clampQty(Number(e.target.value)))}
                className={`${FIELD_CLASS} w-20`}
              />
            </label>
            <button
              type="button"
              className="min-h-9 rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110"
              onClick={() => addToCart(selected, detailQty)}
            >
              Add to cart
            </button>
          </div>
        </div>
        ) : null}
      </dialog>
    ) : null;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Storefront</h1>
          <p className="text-xs text-[var(--color-text-muted)]">
            Workspace kits — place an enquiry, not a card charge.
          </p>
        </div>
        <nav
          className="flex rounded-xl bg-white/5 p-1"
          aria-label="Storefront sections"
        >
          {(
            [
              ['shop', 'Shop'],
              ['cart', `Cart${cartCount ? ` (${cartCount})` : ''}`],
              ['orders', 'My orders'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === id
                  ? 'bg-white/12 text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              aria-current={tab === id ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {error ? (
        <p className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="shrink-0 border-b border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-100">
          {notice}
        </p>
      ) : null}
      {productPending > 0 ? <p className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">{productPending} unresolved Storefront action(s). <button type="button" className="underline" onClick={() => void flushProductActions()}>Resend</button> <button type="button" className="ml-2 underline" onClick={() => void reconcileProductActions()}>Reload and discard conflicts</button></p> : null}

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {products === null ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
          </div>
        ) : null}

        {products && tab === 'shop' ? (
          <>
          {canManageProducts ? <div className="mx-auto mb-4 flex max-w-5xl justify-end"><button type="button" className="min-h-9 rounded-lg bg-white/10 px-3 text-xs font-medium hover:bg-white/15" onClick={() => editProduct()}>Add product</button></div> : null}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
            {products.map((product) => (
              <li key={product.id}>
                <article className="surface flex h-full flex-col overflow-hidden rounded-2xl">
                  <button
                    type="button"
                    onClick={() => openProduct(product)}
                    className="flex min-h-0 flex-1 flex-col p-4 text-left"
                  >
                    <span
                      className="mb-3 block h-16 rounded-xl"
                      style={{
                        background: `linear-gradient(135deg, ${product.accent}cc, ${product.accent}55)`,
                      }}
                      aria-hidden
                    />
                    <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      {product.category}
                    </p>
                    <h2 className="mt-1 text-sm font-semibold">{product.title}</h2>
                    <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {product.summary}
                    </p>
                    <p className="mt-3 text-sm font-medium text-[var(--color-accent)]">
                      {formatStorefrontPrice(product.priceCents)}
                    </p>
                  </button>
                  <div className="border-t border-white/8 px-4 py-3">
                    <button
                      type="button"
                      className="min-h-9 w-full rounded-lg bg-white/8 px-3 py-2 text-xs font-medium transition hover:bg-white/12"
                      onClick={() => addToCart(product, 1)}
                    >
                      Add to cart
                    </button>
                    {canManageProducts ? <button type="button" className="mt-2 min-h-8 w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-white/8" onClick={() => editProduct(product)}>Edit product</button> : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>
          </>
        ) : null}

        {products && tab === 'cart' ? (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
            {cart.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Cart is empty. Add a kit from Shop, then place an order request.
              </p>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={onPlaceOrder}>
                <ul className="flex flex-col gap-3">
                  {cart.map((line) => {
                    const product = productById.get(line.productId);
                    if (!product) return null;
                    return (
                      <li
                        key={line.productId}
                        className="surface flex items-center gap-3 rounded-xl p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {product.title}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {formatStorefrontPrice(product.priceCents)} each
                          </p>
                        </div>
                        <label className="sr-only" htmlFor={`${uid}-qty-${line.productId}`}>
                          Quantity for {product.title}
                        </label>
                        <input
                          id={`${uid}-qty-${line.productId}`}
                          type="number"
                          min={1}
                          max={99}
                          value={line.quantity}
                          onChange={(e) =>
                            setLineQty(line.productId, Number(e.target.value))
                          }
                          className={`${FIELD_CLASS} mt-0 w-16`}
                        />
                        <p className="w-20 text-right text-sm tabular-nums">
                          {formatStorefrontPrice(
                            product.priceCents * line.quantity,
                          )}
                        </p>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-red-300"
                          onClick={() => removeLine(line.productId)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <p className="text-right text-sm font-medium">
                  Total {formatStorefrontPrice(cartTotal)}
                  <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                    enquiry
                  </span>
                </p>

                <div>
                  <label
                    className="text-[11px] font-medium text-[var(--color-text-muted)]"
                    htmlFor={`${uid}-note`}
                  >
                    Note for the request (optional)
                  </label>
                  <textarea
                    id={`${uid}-note`}
                    name="note"
                    className={`${FIELD_CLASS} min-h-24 resize-y`}
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Quantities, delivery site, or questions…"
                  />
                </div>

                <button
                  type="submit"
                  disabled={placing}
                  className="min-h-10 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-60"
                >
                  {placing ? 'Placing…' : 'Place order request'}
                </button>
              </form>
            )}
          </div>
        ) : null}

        {products && tab === 'orders' ? (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
            {orderLoad ? (
              <UserLoadSections
                load={orderLoad}
                empty="No order requests yet in this workspace for you."
                heading="h3"
                renderItems={(items) => (
                  <ul className="flex flex-col gap-3">
                    {items.map((item) => (
                      <li key={`${item.workspaceId}:${item.value.id}`}>
                        <button
                          type="button"
                          className="surface w-full rounded-xl p-4 text-left"
                          onClick={() => {
                            void switchAuthorizedWorkspace(item.workspaceId).then((ok) => {
                              if (ok) window.location.reload();
                            });
                          }}
                        >
                          <p className="text-sm font-medium">
                            {formatStorefrontPrice(item.value.totalCents)} enquiry
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                            {item.value.items.length} item{item.value.items.length === 1 ? '' : 's'}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              />
            ) : orders.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                No order requests yet in this workspace for you.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {orders.map((order) => (
                  <li key={order.id} className="surface rounded-xl p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">
                        {formatStorefrontPrice(order.totalCents)} enquiry
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-amber-200/80">
                      {order.status}
                      {userId === order.userId ? ' · you' : ` · ${order.userName}`}
                    </p>
                    <ul className="mt-2 text-xs text-[var(--color-text-muted)]">
                      {order.items.map((item) => (
                        <li key={`${order.id}-${item.productId}`}>
                          {item.quantity} × {item.title}
                        </li>
                      ))}
                    </ul>
                    {order.note ? (
                      <p className="mt-2 text-xs italic text-[var(--color-text-muted)]">
                        {order.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {mounted ? createPortal(dialog, document.body) : null}
      {productDraft ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProductDraft(null); }}><form className="surface flex max-h-[90vh] w-full max-w-xl flex-col gap-3 overflow-auto rounded-2xl p-5" onSubmit={saveProduct} aria-label={productDraft.id ? 'Edit product' : 'Add product'}>
        <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{productDraft.id ? 'Edit product' : 'Add product'}</h2><button type="button" className="rounded px-2 py-1 text-xs" onClick={() => setProductDraft(null)}>Close</button></div>
        {([['title', 'Title'], ['summary', 'Summary'], ['description', 'Description'], ['category', 'Category'], ['accent', 'Accent color'], ['priceCents', 'Price in cents']] as const).map(([key, label]) => <label key={key} className="text-xs font-medium">{label}<input required={key === 'title' || key === 'priceCents'} type={key === 'priceCents' ? 'number' : 'text'} min={key === 'priceCents' ? 0 : undefined} max={key === 'priceCents' ? 10000000 : undefined} value={productDraft[key]} onChange={(event) => setProductDraft({ ...productDraft, [key]: event.target.value })} className={`${FIELD_CLASS} mt-1`} /></label>)}
        <p className="text-xs text-[var(--color-text-muted)]">Changes are queued in this browser before sending to Rodrigo. Only committed acknowledgements clear them.</p>
        <button type="submit" disabled={productSaving} className="min-h-10 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-surface)] disabled:opacity-60">{productSaving ? 'Saving…' : 'Save product'}</button>
      </form></div> : null}
    </div>
  );
}
