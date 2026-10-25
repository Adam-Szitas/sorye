'use client';

import {
  HUB_MAIL_COMPOSE_EVENT,
  MAIL_PERSONAL_EMAIL_MAX,
  MAIL_PROVIDER_LABELS,
  MAIL_SORYE_ACCOUNT_ID,
  type MailBootstrap,
  type MailComposeDetail,
  type MailConnectedAccount,
  type MailExternalMessage,
  type MailFolderId,
  type MailMessage,
} from '@sorye/types';
import { useCallback, useEffect, useId, useState } from 'react';
import { MailAccountDialog } from '@/components/mail-account-dialog';
import { MailComposeDialog } from '@/components/mail-compose-dialog';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

const STALE_MS = 2 * 60_000;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function folderLabel(folder: MailFolderId, count: number): string {
  const name = folder === 'inbox' ? 'Inbox' : folder === 'sent' ? 'Sent' : 'Drafts';
  return `${name} (${count})`;
}

function MessageReadingPane({
  message,
  folder,
}: {
  message: MailMessage;
  folder: MailFolderId;
}) {
  const peer = folder === 'inbox' ? message.fromName : message.toName;
  const address = folder === 'inbox' ? message.fromAddress : message.toAddress;
  return (
    <article className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {message.subject}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
            {folder === 'inbox' ? 'From' : 'To'} {peer} · {address}
          </p>
        </div>
        <time className="text-[11px] text-[var(--color-text-muted)]">
          {formatWhen(message.createdAt)}
        </time>
      </header>
      {message.imageDataUrl ? (
        <figure className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-black/30">
          <img
            src={message.imageDataUrl}
            alt=""
            className="max-h-64 w-full object-contain"
          />
        </figure>
      ) : null}
      {message.body ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
          {message.body}
        </p>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          No message body.
        </p>
      )}
    </article>
  );
}

function ExternalReadingPane({
  message,
  loading,
}: {
  message: MailExternalMessage;
  loading: boolean;
}) {
  return (
    <article className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {message.subject}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
            {message.folder === 'inbox' ? 'From' : 'To'}{' '}
            {message.folder === 'inbox' ? message.fromName : message.toName} ·{' '}
            {message.folder === 'inbox' ? message.fromAddress : message.toAddress}
          </p>
        </div>
        <time className="text-[11px] text-[var(--color-text-muted)]">
          {formatWhen(message.createdAt)}
        </time>
      </header>
      {loading && !message.body ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          Loading message…
        </p>
      ) : message.body ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
          {message.body}
        </p>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          No message body.
        </p>
      )}
    </article>
  );
}

export function AppMail() {
  const uid = useId();
  const [data, setData] = useState<MailBootstrap | null>(null);
  const [accountId, setAccountId] = useState(MAIL_SORYE_ACCOUNT_ID);
  const [folder, setFolder] = useState<MailFolderId>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [external, setExternal] = useState<MailExternalMessage[]>([]);
  const [externalSelected, setExternalSelected] =
    useState<MailExternalMessage | null>(null);
  const [reading, setReading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<MailComposeDetail | null>(
    null,
  );
  const [personalEmail, setPersonalEmail] = useState('');
  const [notifyMessenger, setNotifyMessenger] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/mail', { credentials: 'include' });
    const next = (await res.json().catch(() => ({}))) as MailBootstrap & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(next.error ?? 'Could not load Mail');
    }
    setData(next);
    setPersonalEmail(next.profile.personalEmail);
    setNotifyMessenger(next.profile.notifyMessenger);
    return next;
  }, []);

  const loadExternal = useCallback(
    async (id: string, nextFolder: MailFolderId) => {
      const res = await fetch(
        `/api/mail/accounts/${id}/messages?folder=${nextFolder}`,
        { credentials: 'include' },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        messages?: MailExternalMessage[];
      };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Could not load messages');
      }
      setExternal(payload.messages ?? []);
      return payload.messages ?? [];
    },
    [],
  );

  const syncAccount = useCallback(
    async (id: string, nextFolder: MailFolderId) => {
      setSyncing(true);
      setError(null);
      try {
        const res = await fetch(`/api/mail/accounts/${id}/sync`, {
          method: 'POST',
          credentials: 'include',
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          account?: MailConnectedAccount;
          folders?: Record<MailFolderId, MailExternalMessage[]>;
        };
        if (!res.ok) {
          throw new Error(payload.error ?? 'Could not sync mail');
        }
        if (payload.account) {
          setData((current) =>
            current
              ? {
                  ...current,
                  accounts: current.accounts.map((account) =>
                    account.id === payload.account!.id
                      ? payload.account!
                      : account,
                  ),
                }
              : current,
          );
        }
        const list = payload.folders?.[nextFolder] ?? [];
        setExternal(list);
        return list;
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load Mail');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (accountId === MAIL_SORYE_ACCOUNT_ID) {
      setExternal([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadExternal(accountId, folder);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load messages');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, folder, loadExternal]);

  useEffect(() => {
    if (!data || accountId === MAIL_SORYE_ACCOUNT_ID) return;
    const account = data.accounts.find((item) => item.id === accountId);
    if (!account) return;
    const stale =
      !account.lastSync ||
      Date.now() - new Date(account.lastSync).getTime() > STALE_MS;
    if (!stale) return;
    void syncAccount(accountId, folder).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not sync mail');
    });
    // Only auto-sync when switching to an account that is stale — not on every data update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function openCompose(initial?: MailComposeDetail) {
    setComposeInitial(initial ?? null);
    setComposeOpen(true);
  }

  function selectAccount(nextId: string) {
    setAccountId(nextId);
    setFolder('inbox');
    setSelectedId(null);
    setExternalSelected(null);
    setExternal([]);
    setConfirmRemove(false);
    setError(null);
  }

  async function copyAddress() {
    if (!data) return;
    try {
      const address =
        accountId === MAIL_SORYE_ACCOUNT_ID
          ? data.profile.generatedAddress
          : (data.accounts.find((account) => account.id === accountId)?.email ??
            data.profile.generatedAddress);
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice('Could not copy address');
    }
  }

  async function saveSettings() {
    if (!data || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/mail', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalEmail, notifyMessenger }),
      });
      const next = (await res.json().catch(() => ({}))) as {
        error?: string;
        profile?: MailBootstrap['profile'];
      };
      if (!res.ok || !next.profile) {
        setError(next.error ?? 'Could not save settings');
        return;
      }
      setData({ ...data, profile: next.profile });
      setPersonalEmail(next.profile.personalEmail);
      setNotifyMessenger(next.profile.notifyMessenger);
      setNotice('Settings saved for this workspace only.');
    } catch {
      setError('Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount() {
    if (accountId === MAIL_SORYE_ACCOUNT_ID || removing) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/mail/accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? 'Could not remove account');
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              accounts: current.accounts.filter((account) => account.id !== accountId),
            }
          : current,
      );
      selectAccount(MAIL_SORYE_ACCOUNT_ID);
      setNotice('Account disconnected. Back on Sorye Mail.');
    } catch {
      setError('Could not remove account');
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  async function openExternalMessage(message: MailExternalMessage) {
    setSelectedId(message.id);
    setExternalSelected(message);
    if (message.body) return;
    setReading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mail/accounts/${message.accountId}/messages/${message.id}`,
        { credentials: 'include' },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: MailExternalMessage;
      };
      if (!res.ok || !payload.message) {
        setError(payload.error ?? 'Could not load message');
        return;
      }
      setExternalSelected(payload.message);
      setExternal((current) =>
        current.map((item) =>
          item.id === payload.message!.id ? payload.message! : item,
        ),
      );
    } catch {
      setError('Could not load message');
    } finally {
      setReading(false);
    }
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
        {error ?? 'Loading Mail…'}
      </div>
    );
  }

  const connected = data.accounts.find((account) => account.id === accountId);
  const usingSorye = accountId === MAIL_SORYE_ACCOUNT_ID || !connected;
  const soryeList = folder === 'sent' ? data.sent : data.inbox;
  const list = usingSorye ? soryeList : external;
  const selected = usingSorye
    ? (soryeList.find((message) => message.id === selectedId) ?? null)
    : externalSelected;
  const fromAddress = usingSorye
    ? data.profile.generatedAddress
    : connected!.email;
  const folders: MailFolderId[] = usingSorye
    ? ['inbox', 'sent']
    : ['inbox', 'sent', 'drafts'];

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Mail</h1>
          <p className="truncate font-mono text-xs text-[var(--color-accent)]">
            {fromAddress}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
            onClick={() => void copyAddress()}
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              settingsOpen
                ? 'bg-white/12 text-[var(--color-text)]'
                : 'bg-white/8 text-[var(--color-text-muted)] hover:bg-white/12 hover:text-[var(--color-text)]'
            }`}
            aria-expanded={settingsOpen}
            aria-controls={`${uid}-settings`}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Settings
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110"
            onClick={() =>
              openCompose(
                usingSorye && data.draft ? { ...data.draft } : undefined,
              )
            }
          >
            Compose
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <section
          id={`${uid}-settings`}
          className="shrink-0 border-b border-white/8 bg-black/15 px-4 py-4 sm:px-5"
          aria-label="Mail settings"
        >
          <form
            className="mx-auto flex max-w-lg flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <p className="text-xs text-[var(--color-text-muted)]">
              The Sorye address is this workspace’s default mailbox. Connected
              accounts send through your provider. Hub is not a public MX.
            </p>
            <div>
              <label className="text-sm font-medium" htmlFor={`${uid}-generated`}>
                Sorye Mail address
              </label>
              <input
                id={`${uid}-generated`}
                className={`${FIELD_CLASS} text-[var(--color-text-muted)]`}
                value={data.profile.generatedAddress}
                readOnly
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`${uid}-personal`}>
                Personal email (optional)
              </label>
              <input
                id={`${uid}-personal`}
                className={FIELD_CLASS}
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={MAIL_PERSONAL_EMAIL_MAX}
                value={personalEmail}
                onChange={(event) => setPersonalEmail(event.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Stored on your profile here only. Not shown to other workspaces.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={notifyMessenger}
                onChange={(event) => setNotifyMessenger(event.target.checked)}
              />
              <span>
                Also notify Messenger
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  Posts a short note to #events when you send from Sorye Mail.
                </span>
              </span>
            </label>
            <button
              type="submit"
              className="self-start rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </section>
      ) : null}

      {error ? (
        <p className="shrink-0 px-4 pt-3 text-xs text-red-300 sm:px-5" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="shrink-0 px-4 pt-3 text-xs text-[var(--color-accent)] sm:px-5"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(12rem,40%)_minmax(0,1fr)] @min-[36rem]:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)] @min-[36rem]:grid-rows-[minmax(12rem,40%)_minmax(0,1fr)] @min-[56rem]:grid-cols-[minmax(12rem,15rem)_minmax(16rem,22rem)_minmax(0,1fr)] @min-[56rem]:grid-rows-none">
        <nav
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-b border-white/8 px-3 py-3 @min-[36rem]:row-span-2 @min-[36rem]:border-b-0 @min-[36rem]:border-r @min-[56rem]:row-span-1"
          aria-label="Mail accounts and folders"
        >
          <div>
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              Accounts
            </p>
            <button
              type="button"
              onClick={() => selectAccount(MAIL_SORYE_ACCOUNT_ID)}
              className={`mt-1 flex w-full flex-col rounded-lg px-2 py-2 text-left transition ${
                usingSorye
                  ? 'bg-white/12 text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-white/6 hover:text-[var(--color-text)]'
              }`}
              aria-current={usingSorye ? 'true' : undefined}
            >
              <span className="text-xs font-medium">Sorye Mail</span>
              <span className="truncate font-mono text-[10px]">
                {data.profile.generatedAddress}
              </span>
            </button>
            {data.accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => selectAccount(account.id)}
                className={`mt-1 flex w-full flex-col rounded-lg px-2 py-2 text-left transition ${
                  accountId === account.id
                    ? 'bg-white/12 text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:bg-white/6 hover:text-[var(--color-text)]'
                }`}
                aria-current={accountId === account.id ? 'true' : undefined}
              >
                <span className="text-xs font-medium">{account.label}</span>
                <span className="truncate font-mono text-[10px]">
                  {account.email}
                </span>
                {account.status === 'error' ? (
                  <span className="mt-0.5 text-[10px] text-red-300">
                    {account.statusMessage ?? 'Needs attention'}
                  </span>
                ) : null}
              </button>
            ))}
            <button
              type="button"
              className="mt-2 w-full rounded-lg bg-white/8 px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
              onClick={() => setAddOpen(true)}
            >
              Add account
            </button>
          </div>

          <div>
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              Folders
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {folders.map((id) => {
                const count = usingSorye
                  ? id === 'sent'
                    ? data.sent.length
                    : data.inbox.length
                  : id === folder
                    ? external.length
                    : 0;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setFolder(id);
                      setSelectedId(null);
                      setExternalSelected(null);
                      if (
                        usingSorye &&
                        !(id === 'sent' ? data.sent : data.inbox).some(
                          (message) => message.id === selectedId,
                        )
                      ) {
                        setSelectedId(null);
                      }
                    }}
                    className={`rounded-lg px-2 py-1.5 text-left text-xs font-medium transition ${
                      folder === id
                        ? 'bg-white/12 text-[var(--color-text)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                    aria-current={folder === id ? 'page' : undefined}
                  >
                    {folderLabel(id, count)}
                  </button>
                );
              })}
            </div>
          </div>

          {!usingSorye && connected ? (
            <div className="mt-auto flex flex-col gap-1">
              <p className="px-1 text-[10px] text-[var(--color-text-muted)]">
                {MAIL_PROVIDER_LABELS[connected.provider]}
                {connected.lastSync
                  ? ` · synced ${formatWhen(connected.lastSync)}`
                  : ' · not synced yet'}
              </p>
              <button
                type="button"
                className="rounded-lg bg-white/8 px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)] disabled:opacity-50"
                disabled={syncing}
                onClick={() => void syncAccount(connected.id, folder).catch((err) => {
                  setError(err instanceof Error ? err.message : 'Could not sync mail');
                })}
              >
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1.5 text-xs text-red-300/90 transition hover:bg-red-400/10"
                disabled={removing}
                onClick={() => void removeAccount()}
              >
                {confirmRemove
                  ? 'Confirm remove'
                  : removing
                    ? 'Removing…'
                    : 'Remove account'}
              </button>
            </div>
          ) : null}
        </nav>

        <section
          className="flex min-h-0 min-w-0 flex-col border-b border-white/8 @min-[56rem]:border-b-0 @min-[56rem]:border-r"
          aria-label="Message list"
        >
          {list.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-text-muted)]">
              {folder === 'inbox'
                ? usingSorye
                  ? 'No incoming mail yet.'
                  : syncing
                    ? 'Syncing inbox…'
                    : 'No incoming mail yet. Sync if this inbox should have mail.'
                : folder === 'sent'
                  ? 'Nothing sent yet.'
                  : 'No drafts.'}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {usingSorye
                ? (list as MailMessage[]).map((message) => {
                    const peer =
                      folder === 'inbox' ? message.fromName : message.toName;
                    const active = message.id === selectedId;
                    return (
                      <li key={message.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(message.id)}
                          className={`flex w-full flex-col gap-0.5 border-t border-white/6 px-4 py-3 text-left transition ${
                            active ? 'bg-white/10' : 'hover:bg-white/6'
                          }`}
                          aria-current={active ? 'true' : undefined}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {message.subject}
                            </span>
                            <time className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                              {formatWhen(message.createdAt)}
                            </time>
                          </span>
                          <span className="truncate text-xs text-[var(--color-text-muted)]">
                            {folder === 'inbox' ? 'From' : 'To'} {peer}
                          </span>
                        </button>
                      </li>
                    );
                  })
                : (list as MailExternalMessage[]).map((message) => {
                    const peer =
                      folder === 'inbox' ? message.fromName : message.toName;
                    const active = message.id === selectedId;
                    return (
                      <li key={message.id}>
                        <button
                          type="button"
                          onClick={() => void openExternalMessage(message)}
                          className={`flex w-full flex-col gap-0.5 border-t border-white/6 px-4 py-3 text-left transition ${
                            active ? 'bg-white/10' : 'hover:bg-white/6'
                          }`}
                          aria-current={active ? 'true' : undefined}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {message.subject}
                            </span>
                            <time className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                              {formatWhen(message.createdAt)}
                            </time>
                          </span>
                          <span className="truncate text-xs text-[var(--color-text-muted)]">
                            {folder === 'inbox' ? 'From' : 'To'} {peer}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 min-w-0 flex-col" aria-label="Message">
          {usingSorye && selected && 'toUserId' in selected ? (
            <MessageReadingPane
              message={selected as MailMessage}
              folder={folder}
            />
          ) : !usingSorye && selected && 'uid' in selected ? (
            <ExternalReadingPane
              message={selected as MailExternalMessage}
              loading={reading}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a message
              </p>
              <button
                type="button"
                className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
                onClick={() =>
                  openCompose(
                    usingSorye && data.draft ? { ...data.draft } : undefined,
                  )
                }
              >
                Compose
              </button>
            </div>
          )}
        </section>
      </div>

      <MailComposeDialog
        open={composeOpen}
        members={data.members}
        currentUserId={data.profile.userId}
        initial={composeInitial}
        accountId={usingSorye ? undefined : accountId}
        fromAddress={fromAddress}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          setNotice(
            usingSorye
              ? 'Sent in-workspace. Not delivered to the public internet.'
              : `Sent from ${fromAddress}.`,
          );
          setFolder('sent');
          if (usingSorye) {
            void load().then((next) => {
              const latest = next?.sent[0];
              if (latest) setSelectedId(latest.id);
            });
          } else {
            void syncAccount(accountId, 'sent').catch(() => undefined);
          }
        }}
      />
      <MailAccountDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(account) => {
          setData((current) =>
            current
              ? { ...current, accounts: [...current.accounts, account] }
              : current,
          );
          selectAccount(account.id);
          setNotice(`Connected ${account.email}. Syncing inbox…`);
        }}
      />
    </div>
  );
}

export function MailComposeHost() {
  const [data, setData] = useState<MailBootstrap | null>(null);
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<MailComposeDetail | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/mail', { credentials: 'include' });
    if (!res.ok) return null;
    const next = (await res.json()) as MailBootstrap;
    setData(next);
    return next;
  }, []);

  useEffect(() => {
    function onCompose(event: Event) {
      const detail = (event as CustomEvent<MailComposeDetail>).detail ?? {};
      setInitial(detail);
      void load().then((next) => {
        if (next) setOpen(true);
      });
    }
    window.addEventListener(HUB_MAIL_COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(HUB_MAIL_COMPOSE_EVENT, onCompose);
  }, [load]);

  if (!open) return null;

  return (
    <MailComposeDialog
      open={open}
      members={data?.members ?? []}
      currentUserId={data?.profile.userId ?? ''}
      initial={initial}
      fromAddress={data?.profile.generatedAddress}
      onClose={() => setOpen(false)}
      onSent={() => void load()}
    />
  );
}
