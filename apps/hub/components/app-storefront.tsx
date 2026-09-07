'use client';

import {
  formatStorefrontPrice,
  type StorefrontOrder,
  type StorefrontProduct,
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tab, setTab] = useState<Tab>('shop');
  const [selected, setSelected] = useState<StorefrontProduct | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const data = (await res.json()) as { orders?: StorefrontOrder[] };
    setOrders(data.orders ?? []);
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
          user?: { id?: string };
          workspace?: { id?: string };
        };
        const catalog = (await productsRes.json()) as {
          products?: StorefrontProduct[];
        };
        const ws = session.workspace?.id;
        if (!ws || cancelled) return;
        setWorkspaceId(ws);
        setUserId(session.user?.id ?? null);
        setProducts(catalog.products ?? []);
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

    setPlacing(true);
    setError(null);
    try {
      const res = await fetch('/api/storefront/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
          note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        order?: StorefrontOrder;
      };
      if (!res.ok || !data.order) {
        setError(data.error ?? 'Could not place the order request.');
        return;
      }
      persistCart(workspaceId, []);
      setNote('');
      setNotice(
        `Order request ${data.order.id} saved for this workspace — no payment taken.`,
      );
      await loadOrders();
      setTab('orders');
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
              Close
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

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {products === null ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
          </div>
        ) : null}

        {products && tab === 'shop' ? (
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
                  </div>
                </article>
              </li>
            ))}
          </ul>
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
            {orders.length === 0 ? (
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
    </div>
  );
}
