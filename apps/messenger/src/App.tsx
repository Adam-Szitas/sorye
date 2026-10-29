import { uploadToDrive } from '@sorye/sdk/files';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  MessengerBootstrap,
  MessengerChannel,
  MessengerMember,
  MessengerMessage,
} from '@sorye/types';
import { HUB_MAIL_COMPOSE_EVENT, MESSENGER_PAGE_SIZE } from '@sorye/types';
import { compressImageFile, formatBytes } from './image-compress';
import {
  createChannel,
  fetchMessages,
  loadMessenger,
  markMessengerRead,
  mergeMessages,
  openDm,
  pollMessages,
  sendMessage,
} from './messenger-api';
import './styles.css';

function channelLabel(
  channel: MessengerChannel,
  members: MessengerMember[],
  myId: string,
): string {
  if (channel.kind === 'channel') return `#${channel.name}`;
  const peerId = channel.memberIds.find((id) => id !== myId);
  const peer = members.find((m) => m.id === peerId);
  return peer?.displayName ?? 'Direct message';
}

function pickDefaultChannel(next: MessengerBootstrap): string | null {
  const events = next.channels.find(
    (c) => c.kind === 'channel' && c.name === 'events',
  );
  if (next.events?.alive && events) return events.id;
  return next.channels[0]?.id ?? null;
}

function renderMessageText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const code = line.match(/^`([^`]+)`$/);
    if (code) {
      return (
        <code key={i} className="event-code">
          {code[1]}
        </code>
      );
    }
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      return (
        <strong key={i}>
          {line.slice(2, -2)}
          {i < lines.length - 1 ? <br /> : null}
        </strong>
      );
    }
    return (
      <span key={i}>
        {line}
        {i < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

export default function App() {
  const [data, setData] = useState<MessengerBootstrap | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [compressNote, setCompressNote] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const [dmOpen, setDmOpen] = useState(false);
  const [mobileShowChannels, setMobileShowChannels] = useState(true);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [threadMessages, setThreadMessages] = useState<MessengerMessage[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastMessageCursorRef = useRef<{ createdAt: string; id: string } | undefined>(undefined);
  const threadReqRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const pendingRestore = useRef<{ height: number; top: number } | null>(null);
  const hasMoreOlderRef = useRef(false);
  const threadMessagesRef = useRef<MessengerMessage[]>([]);

  const refresh = useCallback(async () => {
    const next = await loadMessenger();
    setData(next);
    setChannelId((prev) => {
      if (prev && next.channels.some((c) => c.id === prev)) return prev;
      return pickDefaultChannel(next);
    });
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await loadMessenger();
        if (cancelled) return;
        setData(next);
        setChannelId(pickDefaultChannel(next));
        await markMessengerRead();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!channelId || loading) return;
    void markMessengerRead(channelId);
  }, [channelId, loading]);

  const messages = threadMessages;
  threadMessagesRef.current = threadMessages;
  hasMoreOlderRef.current = hasMoreOlder;

  const activeChannel = data?.channels.find((c) => c.id === channelId);
  const isEventsChannel = activeChannel?.name === 'events';
  const publicChannels = useMemo(() => {
    const list = data?.channels.filter((c) => c.kind === 'channel') ?? [];
    return [...list].sort((a, b) => {
      if (a.name === 'events') return -1;
      if (b.name === 'events') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [data]);
  const dmChannels = data?.channels.filter((c) => c.kind === 'dm') ?? [];

  const dmCandidates = useMemo(() => {
    if (!data) return [];
    const existingPeers = new Set(
      dmChannels.flatMap((c) => c.memberIds.filter((id) => id !== data.user.id)),
    );
    return data.members.filter(
      (m) => m.id !== data.user.id && !existingPeers.has(m.id),
    );
  }, [data, dmChannels]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollerRef.current;
    if (!el) return;
    stickToBottom.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const loadLatest = useCallback(async (id: string) => {
    const req = ++threadReqRef.current;
    setThreadLoading(true);
    setHasMoreOlder(false);
    setThreadMessages([]);
    setShowJump(false);
    stickToBottom.current = true;
    pendingRestore.current = null;
    lastMessageCursorRef.current = undefined;
    try {
      const page = await fetchMessages({
        channelId: id,
        limit: MESSENGER_PAGE_SIZE,
      });
      if (req !== threadReqRef.current) return;
      setThreadMessages(page.messages);
      setHasMoreOlder(page.hasMore);
      lastMessageCursorRef.current = page.messages.at(-1)
        ? { createdAt: page.messages.at(-1)!.createdAt, id: page.messages.at(-1)!.id }
        : undefined;
    } catch (err) {
      if (req !== threadReqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      if (req === threadReqRef.current) setThreadLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const id = channelId;
    if (!id || loadingOlderRef.current || !hasMoreOlderRef.current) return;
    const oldest = threadMessagesRef.current[0];
    if (!oldest) return;
    const el = scrollerRef.current;
    const req = threadReqRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    if (el) {
      pendingRestore.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    try {
      const page = await fetchMessages({
        channelId: id,
        before: oldest.id,
        limit: MESSENGER_PAGE_SIZE,
      });
      if (req !== threadReqRef.current) return;
      setThreadMessages((prev) => mergeMessages(page.messages, prev));
      setHasMoreOlder(page.hasMore);
    } catch {
      pendingRestore.current = null;
      setHasMoreOlder(false);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [channelId]);

  useEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    if (!channelId) {
      threadReqRef.current += 1;
      setThreadMessages([]);
      setHasMoreOlder(false);
      setThreadLoading(false);
      return;
    }
    void loadLatest(channelId);
  }, [channelId, loadLatest]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const restore = pendingRestore.current;
    if (restore) {
      el.scrollTop = restore.top + (el.scrollHeight - restore.height);
      pendingRestore.current = null;
      return;
    }
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, channelId, threadLoading]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || threadLoading || loadingOlder || !hasMoreOlder) return;
    if (el.scrollHeight <= el.clientHeight + 24) {
      void loadOlder();
    }
  }, [messages, hasMoreOlder, threadLoading, loadingOlder, loadOlder]);

  useEffect(() => {
    const root = scrollerRef.current;
    const top = topSentinelRef.current;
    if (!root || !top || threadLoading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
      },
      { root, rootMargin: '120px 0px 0px 0px', threshold: 0 },
    );
    io.observe(top);
    return () => io.disconnect();
  }, [channelId, loadOlder, threadLoading, messages.length]);

  useEffect(() => {
    if (!channelId) return;
    const latest = messages.at(-1);
    if (latest) lastMessageCursorRef.current = { createdAt: latest.createdAt, id: latest.id };
  }, [channelId, messages]);

  useEffect(() => {
    if (!channelId || threadLoading) return;
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        let cursor = lastMessageCursorRef.current;
        const caughtUp: MessengerMessage[] = [];
        // Bound each poll cycle so a busy channel cannot monopolize the tab.
        for (let pageCount = 0; pageCount < 4; pageCount += 1) {
          const page = await pollMessages(channelId, cursor);
          if (cancelled || page.messages.length === 0) break;
          caughtUp.push(...page.messages);
          const latest = page.messages.at(-1)!;
          cursor = { createdAt: latest.createdAt, id: latest.id };
          if (!page.hasMore) break;
        }
        if (cancelled || caughtUp.length === 0) return;
        lastMessageCursorRef.current = cursor;
        setThreadMessages((prev) => mergeMessages(prev, caughtUp));
        void markMessengerRead(channelId);
      } catch {
        // ignore transient poll errors
      } finally {
        inFlight = false;
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [channelId, threadLoading]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible' && channelId && !threadLoading) {
        void pollMessages(channelId, lastMessageCursorRef.current).then((page) => {
          if (page.messages.length === 0) return;
          const latest = page.messages.at(-1)!;
          lastMessageCursorRef.current = { createdAt: latest.createdAt, id: latest.id };
          setThreadMessages((prev) => mergeMessages(prev, page.messages));
          void markMessengerRead(channelId);
        }).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [channelId, threadLoading]);

  async function forwardToMail(msg: MessengerMessage) {
    const subject = msg.text?.trim()
      ? `Fwd: ${msg.text.trim().split('\n')[0]!.slice(0, 80)}`
      : msg.kind === 'image'
        ? 'Fwd: photo from Messenger'
        : 'Fwd: Messenger message';
    const stamp = new Date(msg.createdAt).toLocaleString();
    const body = [
      `Forwarded from Messenger`,
      `${msg.author.name} · ${stamp}`,
      msg.text?.trim() ? `\n${msg.text.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    setError(null);
    try {
      const res = await fetch('/api/mail/forward', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body,
          imageDataUrl: msg.imageDataUrl,
          authorName: msg.author.name,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not open Mail');
      }
      window.dispatchEvent(
        new CustomEvent(HUB_MAIL_COMPOSE_EVENT, {
          detail: {
            subject,
            body,
            imageDataUrl: msg.imageDataUrl,
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not forward to Mail');
    }
  }

  async function sendText() {
    if (!channelId || !draft.trim()) return;
    try {
      const message = await sendMessage({
        channelId,
        kind: 'text',
        text: draft.trim(),
      });
      setThreadMessages((prev) => mergeMessages(prev, [message]));
      lastMessageCursorRef.current = { createdAt: message.createdAt, id: message.id };
      stickToBottom.current = true;
      setShowJump(false);
      setDraft('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  }

  async function onPickImage(file: File | null) {
    if (!file || !channelId) return;
    setUploading(true);
    setCompressNote(null);
    setError(null);
    try {
      const compressed = await compressImageFile(file);
      await uploadToDrive(file, 'messenger');
      setCompressNote(
        `${formatBytes(compressed.originalBytes)} → ${formatBytes(compressed.bytesApprox)} · ${compressed.width}×${compressed.height}`,
      );
      const message = await sendMessage({
        channelId,
        kind: 'image',
        text: draft.trim() || undefined,
        imageDataUrl: compressed.dataUrl,
        imageBytes: compressed.bytesApprox,
        imageWidth: compressed.width,
        imageHeight: compressed.height,
      });
      setThreadMessages((prev) => mergeMessages(prev, [message]));
      lastMessageCursorRef.current = { createdAt: message.createdAt, id: message.id };
      stickToBottom.current = true;
      setShowJump(false);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    try {
      const channel = await createChannel(newChannel);
      setNewChannel('');
      await refresh();
      setChannelId(channel.id);
      setMobileShowChannels(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create channel');
    }
  }

  async function startDm(peerUserId: string) {
    try {
      const channel = await openDm(peerUserId);
      setDmOpen(false);
      await refresh();
      setChannelId(channel.id);
      setMobileShowChannels(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open DM');
    }
  }

  async function sendTestEvent() {
    setEventsBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sorye.test.ping',
          payload: {
            title: 'Test event',
            summary: 'Manual ping from Messenger #events',
            appId: 'messenger',
          },
        }),
      });
      const body = (await res.json()) as {
        delivered?: boolean;
        reason?: string;
      };
      if (!res.ok) throw new Error(body.reason || 'Test event failed');
      if (!body.delivered) {
        setError(body.reason || 'Event was not delivered');
      }
      const next = await refresh();
      const eventsCh = next.channels.find((c) => c.name === 'events');
      if (eventsCh) {
        if (eventsCh.id === channelId) {
          void loadLatest(eventsCh.id);
        } else {
          setChannelId(eventsCh.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test event failed');
    } finally {
      setEventsBusy(false);
    }
  }

  async function toggleEventsDelivery() {
    if (!data?.events) return;
    setEventsBusy(true);
    try {
      const res = await fetch('/api/events', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverToMessengerEvents: !data.events.deliverToMessengerEvents,
        }),
      });
      if (!res.ok) throw new Error('Could not update settings');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings update failed');
    } finally {
      setEventsBusy(false);
    }
  }

  if (loading) {
    return <div className="messenger-state">Loading Messenger…</div>;
  }

  if (!data) {
    return (
      <div className="messenger-state error">
        {error ?? 'Messenger unavailable'}
      </div>
    );
  }

  const title = activeChannel
    ? channelLabel(activeChannel, data.members, data.user.id)
    : 'Messenger';

  return (
    <div
      className={`messenger${mobileShowChannels ? '' : ' thread-focus'}`}
    >
      <aside
        className={`messenger-sidebar${mobileShowChannels ? '' : ' hide-mobile'}`}
      >
        <div className="sidebar-head">
          <h1>Messenger</h1>
          <p>
            {data.events?.alive
              ? 'Events live · core movements → #events'
              : data.events?.enabled
                ? 'Events on — enable Messenger + another app'
                : 'App events off · enable in Dashboard'}
          </p>
        </div>

        {!data.events?.alive ? (
          <div className="events-inactive">
            {data.events?.enabled
              ? 'Enable Messenger and at least one other app so movements can stream into #events.'
              : 'App events are off by default. Turn them on in Dashboard → App events.'}
          </div>
        ) : null}

        <div className="sidebar-section">
          <h2>Channels</h2>
          <ul className="channel-list">
            {publicChannels.map((ch) => (
              <li key={ch.id}>
                <button
                  type="button"
                  className={ch.id === channelId ? 'active' : undefined}
                  onClick={() => {
                    setChannelId(ch.id);
                    setMobileShowChannels(false);
                  }}
                >
                  <span aria-hidden>#</span>
                  {ch.name}
                  {ch.name === 'events' && data.events?.alive ? (
                    <em className="events-pill">live</em>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-section">
          <div className="section-row">
            <h2>Direct messages</h2>
            <button
              type="button"
              className="linkish"
              onClick={() => setDmOpen((v) => !v)}
              disabled={
                data.members.filter((m) => m.id !== data.user.id).length === 0
              }
              title={
                data.members.length < 2
                  ? 'Add teammates to a team workspace to DM'
                  : 'Message a teammate'
              }
            >
              {dmOpen ? 'Close' : 'New'}
            </button>
          </div>

          {dmOpen ? (
            <ul className="member-pick">
              {dmCandidates.length === 0 ? (
                <li className="hint-li">
                  {data.members.length < 2
                    ? 'No other members in this workspace yet.'
                    : 'You already have a DM with everyone here.'}
                </li>
              ) : (
                dmCandidates.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => void startDm(m.id)}>
                      {m.displayName}
                      <em>{m.email}</em>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          <ul className="channel-list">
            {dmChannels.map((ch) => (
              <li key={ch.id}>
                <button
                  type="button"
                  className={ch.id === channelId ? 'active' : undefined}
                  onClick={() => {
                    setChannelId(ch.id);
                    setMobileShowChannels(false);
                  }}
                >
                  <span aria-hidden className="dm-mark">
                    @
                  </span>
                  {channelLabel(ch, data.members, data.user.id)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <form
          className="new-channel"
          onSubmit={(e) => void handleCreateChannel(e)}
        >
          <input
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            placeholder="New channel"
            maxLength={32}
            aria-label="New channel name"
          />
          <button type="submit" disabled={!newChannel.trim()}>
            Add
          </button>
        </form>
      </aside>

      <section className="messenger-thread" aria-label="Conversation">
        <header className="thread-head">
          <button
            type="button"
            className="back-channels"
            onClick={() => setMobileShowChannels(true)}
          >
            Channels
          </button>
          <h2>{title}</h2>
          <p>
            {isEventsChannel
              ? data.events?.alive
                ? data.events.deliverToMessengerEvents
                  ? 'Default webhook sink · core app movements land here'
                  : 'Delivery paused · toggle below to resume'
                : data.events?.enabled
                  ? 'Feature on — waiting for Messenger + another app'
                  : 'Turn on App events in Dashboard to start this feed'
              : activeChannel?.kind === 'dm'
                ? 'Private · synced for both teammates'
                : 'Text & compressed photos · team-synced'}
          </p>
        </header>

        {isEventsChannel ? (
          <div className="events-toolbar">
            <a className="events-dash-link" href="/apps/dashboard">
              {data.events?.enabled ? 'Manage in Dashboard' : 'Enable in Dashboard'}
            </a>
            <button
              type="button"
              disabled={eventsBusy || !data.events?.alive}
              onClick={() => void sendTestEvent()}
            >
              {eventsBusy ? 'Working…' : 'Send test event'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={eventsBusy || !data.events?.alive}
              onClick={() => void toggleEventsDelivery()}
            >
              {data.events?.deliverToMessengerEvents
                ? 'Pause #events delivery'
                : 'Resume #events delivery'}
            </button>
          </div>
        ) : null}

        {error ? <div className="banner-error">{error}</div> : null}
        {compressNote ? (
          <div className="banner-info" role="status">
            Image reduced: {compressNote}
          </div>
        ) : null}

        <div className="message-pane">
          <div
            className="message-scroller"
            ref={scrollerRef}
            onScroll={() => {
              const el = scrollerRef.current;
              if (!el) return;
              const nearBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 96;
              stickToBottom.current = nearBottom;
              const shouldJump =
                !nearBottom && threadMessagesRef.current.length > 0;
              setShowJump((prev) => (prev === shouldJump ? prev : shouldJump));
              if (el.scrollTop < 80) void loadOlder();
            }}
          >
            {!channelId || (messages.length === 0 && !threadLoading) ? (
              <p className="empty-thread">
                {isEventsChannel
                  ? data.events?.alive
                    ? 'No movements yet. Create a task, note, or calendar event — or send a test event.'
                    : data.events?.enabled
                      ? 'Enable Messenger and at least one other app in the Hub.'
                      : 'Open Dashboard → App events and turn on the feature flag.'
                  : activeChannel?.kind === 'dm'
                    ? 'Start the conversation — only you two can see it.'
                    : 'No messages yet. Say hello or attach a photo.'}
              </p>
            ) : (
              <div className="message-stack">
                <div
                  ref={topSentinelRef}
                  className="thread-sentinel"
                  aria-hidden
                />
                {loadingOlder ? (
                  <p className="history-status">Loading earlier messages…</p>
                ) : !hasMoreOlder && messages.length > 0 ? (
                  <p className="history-status">Beginning of conversation</p>
                ) : null}
                {threadLoading ? (
                  <p className="history-status">Loading conversation…</p>
                ) : null}
                {messages.map((msg: MessengerMessage) => {
                  const mine = msg.author.id === data.user.id;
                  const system = msg.author.id === 'sorye-events';
                  return (
                    <article
                      key={msg.id}
                      className={`bubble ${mine ? 'mine' : 'theirs'}${system ? ' system' : ''}`}
                    >
                      <header>
                        <strong>{msg.author.name}</strong>
                        <time>
                          {new Date(msg.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </header>
                      {msg.kind === 'image' && msg.imageDataUrl ? (
                        <figure>
                          <img
                            src={msg.imageDataUrl}
                            alt={msg.text || 'Uploaded image'}
                            width={msg.imageWidth}
                            height={msg.imageHeight}
                            onLoad={() => {
                              if (stickToBottom.current) scrollToLatest();
                            }}
                          />
                          {msg.imageBytes != null ? (
                            <figcaption>{formatBytes(msg.imageBytes)}</figcaption>
                          ) : null}
                        </figure>
                      ) : null}
                      {msg.text ? (
                        <p className={system ? 'event-body' : undefined}>
                          {system ? renderMessageText(msg.text) : msg.text}
                        </p>
                      ) : null}
                      <footer className="bubble-actions">
                        <button
                          type="button"
                          className="fwd-mail"
                          onClick={() => void forwardToMail(msg)}
                        >
                          Forward to Mail
                        </button>
                      </footer>
                    </article>
                  );
                })}
                <div ref={bottomRef} className="thread-sentinel" aria-hidden />
              </div>
            )}
          </div>
          {showJump ? (
            <button
              type="button"
              className="jump-latest"
              onClick={() => scrollToLatest()}
            >
              Latest
            </button>
          ) : null}
        </div>

        <footer className="composer">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void onPickImage(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="attach"
            title="Attach picture"
            disabled={uploading || !channelId}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '…' : 'Photo'}
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isEventsChannel
                ? 'Comment on an event…'
                : activeChannel?.kind === 'dm'
                  ? 'Direct message…'
                  : 'Message…'
            }
            rows={1}
            disabled={!channelId}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendText();
              }
            }}
          />
          <button
            type="button"
            className="send"
            disabled={!draft.trim() || uploading || !channelId}
            onClick={() => void sendText()}
          >
            Send
          </button>
        </footer>
      </section>
    </div>
  );
}
