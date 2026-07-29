import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MessengerBootstrap,
  MessengerChannel,
  MessengerMember,
  MessengerMessage,
} from '@sorye/types';
import { compressImageFile, formatBytes } from './image-compress';
import {
  createChannel,
  loadMessenger,
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastMsgAtRef = useRef<string | undefined>(undefined);

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

  const messages = useMemo(() => {
    if (!data || !channelId) return [];
    return data.messages
      .filter((m) => m.channelId === channelId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data, channelId]);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, channelId]);

  useEffect(() => {
    if (!channelId) return;
    lastMsgAtRef.current = messages.at(-1)?.createdAt;
  }, [channelId, messages]);

  useEffect(() => {
    if (!channelId) return;
    const timer = window.setInterval(async () => {
      const after = lastMsgAtRef.current;
      const newer = await pollMessages(channelId, after);
      if (newer.length === 0) return;
      setData((prev) => {
        if (!prev) return prev;
        const ids = new Set(prev.messages.map((m) => m.id));
        const merged = [...prev.messages];
        for (const m of newer) {
          if (!ids.has(m.id)) merged.push(m);
        }
        return { ...prev, messages: merged };
      });
      lastMsgAtRef.current = newer.at(-1)?.createdAt ?? after;
    }, 2500);
    return () => window.clearInterval(timer);
  }, [channelId]);

  async function sendText() {
    if (!channelId || !draft.trim()) return;
    try {
      const message = await sendMessage({
        channelId,
        kind: 'text',
        text: draft.trim(),
      });
      setData((prev) =>
        prev ? { ...prev, messages: [...prev.messages, message] } : prev,
      );
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
      setData((prev) =>
        prev ? { ...prev, messages: [...prev.messages, message] } : prev,
      );
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
      if (eventsCh) setChannelId(eventsCh.id);
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

        <div className="message-scroller">
          {!channelId || messages.length === 0 ? (
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
            messages.map((msg: MessengerMessage) => {
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
                      <a
                        href={msg.imageDataUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={msg.imageDataUrl}
                          alt={msg.text || 'Uploaded image'}
                          width={msg.imageWidth}
                          height={msg.imageHeight}
                        />
                      </a>
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
                </article>
              );
            })
          )}
          <div ref={bottomRef} />
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
