import { registerPendingActionFlusher, switchAuthorizedWorkspace } from '@sorye/platform';
import { UserLoadSections } from '@sorye/platform/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  HubOpenAppDetail,
  MessengerBootstrap,
  MessengerChannel,
  MessengerMember,
  MessengerMessage,
} from '@sorye/types';
import {
  HUB_MAIL_COMPOSE_EVENT,
  HUB_OPEN_APP_EVENT,
  MESSENGER_PAGE_SIZE,
  activeMentionQuery,
  hubOpenTargetKey,
  mentionToken,
  mentionsFromText,
} from '@sorye/types';
import {
  createChannel,
  discardMessengerConflicts,
  fetchMessages,
  getMessengerQueueState,
  loadMessenger,
  mergeMessages,
  openDm,
  pollMessages,
  resendMessengerActions,
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

function renderPingText(text: string) {
  const pattern = /@\[([^\]\r\n]{1,80})\]\(([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\)/g;
  const parts: Array<string | { name: string; id: string }> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push({ name: match[1], id: match[2] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part, index) =>
    typeof part === 'string' ? (
      <span key={index}>{part}</span>
    ) : (
      <mark key={`${part.id}-${index}`} className="mention">
        @{part.name}
      </mark>
    ),
  );
}

function isImeEnter(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function readStoredChannel(): string | null {
  try {
    const raw = sessionStorage.getItem(hubOpenTargetKey('messenger'));
    if (!raw) return null;
    sessionStorage.removeItem(hubOpenTargetKey('messenger'));
    const parsed = JSON.parse(raw) as { channelId?: unknown };
    return typeof parsed.channelId === 'string' ? parsed.channelId : null;
  } catch {
    return null;
  }
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
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState<MessengerMember[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueState, setQueueState] = useState({ pending: 0, failed: 0, conflicts: 0, rejected: 0 });
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCursorRef = useRef<{ createdAt: string; id: string } | undefined>(undefined);
  const threadReqRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const pendingRestore = useRef<{ height: number; top: number } | null>(null);
  const hasMoreOlderRef = useRef(false);
  const threadMessagesRef = useRef<MessengerMessage[]>([]);

  const refreshQueueState = useCallback(async () => {
    try { setQueueState(await getMessengerQueueState()); } catch { /* Session/API can be unavailable before bootstrap. */ }
  }, []);

  const refresh = useCallback(async () => {
    const next = await loadMessenger();
    setData(next);
    setChannelId((prev) => {
      if (prev && next.channels.some((c) => c.id === prev)) return prev;
      return pickDefaultChannel(next);
    });
    return next;
  }, []);

  const selectChannel = useCallback(async (channel: MessengerChannel) => {
    if (data && channel.workspaceId !== data.workspace.id) {
      const switched = await switchAuthorizedWorkspace(channel.workspaceId);
      if (!switched) {
        setError('Could not open that workspace.');
        return;
      }
      const next = await loadMessenger();
      setData(next);
      setChannelId(channel.id);
      setMobileShowChannels(false);
      return;
    }
    setChannelId(channel.id);
    setMobileShowChannels(false);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await loadMessenger();
        if (cancelled) return;
        setData(next);
        await refreshQueueState();
        const opened = readStoredChannel();
        const known = new Set([
          ...next.channels.map((channel) => channel.id),
          ...(next.load?.personal ?? []).flatMap((group) => group.items.map((item) => item.value.id)),
          ...(next.load?.work ?? []).flatMap((group) => group.items.map((item) => item.value.id)),
        ]);
        setChannelId(opened && known.has(opened) ? opened : pickDefaultChannel(next));
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
  }, [refreshQueueState]);

  useEffect(() => {
    const flushBestEffort = async () => {
      await resendMessengerActions().catch(() => undefined);
      const state = await getMessengerQueueState().catch(() => ({ pending: 1, failed: 0, conflicts: 0, rejected: 0 }));
      return state.pending + state.failed + state.conflicts + state.rejected;
    };
    const unregister = registerPendingActionFlusher('messenger', flushBestEffort);
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flushBestEffort(); else void refreshQueueState(); };
    window.addEventListener('pagehide', flushBestEffort);
    window.addEventListener('sorye:logout-flush', flushBestEffort);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushBestEffort);
      window.removeEventListener('sorye:logout-flush', flushBestEffort);
      document.removeEventListener('visibilitychange', onVisibility);
      unregister();
    };
  }, [refreshQueueState]);

  useEffect(() => {
    if (!channelId || loading) return;
  }, [channelId, loading]);

  const mentionQuery = activeMentionQuery(draft, cursor);
  const mentionKey = mentionQuery ? `${mentionQuery.start}:${mentionQuery.query}` : '';

  useEffect(() => {
    if (!channelId || !mentionKey || dismissedQuery === mentionKey) {
      setSuggestions((current) => (current.length === 0 ? current : []));
      return;
    }
    const query = mentionKey.slice(mentionKey.indexOf(':') + 1);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        channelId,
        q: query,
      });
      void fetch(`/api/messenger?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) return [];
          const body = (await res.json()) as { members?: MessengerMember[] };
          return body.members ?? [];
        })
        .then((members) => {
          if (controller.signal.aborted) return;
          setSuggestions(members);
          setSuggestionIndex(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [channelId, mentionKey, dismissedQuery]);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<HubOpenAppDetail>).detail;
      if (!detail || detail.appId !== 'messenger' || !detail.channelId) return;
      const nextId = detail.channelId;
      void (async () => {
        try {
          const next = await loadMessenger();
          setData(next);
          setChannelId(nextId);
          setMobileShowChannels(false);
        } catch {
          setChannelId(nextId);
        }
      })();
    }
    window.addEventListener(HUB_OPEN_APP_EVENT, onOpen);
    return () => window.removeEventListener(HUB_OPEN_APP_EVENT, onOpen);
  }, []);

  const messages = threadMessages;
  threadMessagesRef.current = threadMessages;
  hasMoreOlderRef.current = hasMoreOlder;

  const activeChannel = data?.channels.find((c) => c.id === channelId);
  const isEventsChannel = activeChannel?.name === 'events';
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

  function chooseMention(member: MessengerMember) {
    const query = activeMentionQuery(draft, cursor);
    if (!query) return;
    const token = `${mentionToken(member.displayName, member.id)} `;
    const next = `${draft.slice(0, query.start)}${token}${draft.slice(query.end)}`;
    const nextCursor = query.start + token.length;
    setDraft(next);
    setCursor(nextCursor);
    setSuggestions([]);
    setDismissedQuery('');
    requestAnimationFrame(() => {
      const field = composerRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function sendText() {
    if (!channelId || !draft.trim()) return;
    const mentions = mentionsFromText(draft.trim());
    try {
      const message = await sendMessage({
        channelId,
        kind: 'text',
        text: draft.trim(),
        mentions: mentions.map((mention) => ({ userId: mention.userId })),
      });
      setThreadMessages((prev) => mergeMessages(prev, [{ ...message, author: data?.user ?? message.author }]));
      lastMessageCursorRef.current = { createdAt: message.createdAt, id: message.id };
      stickToBottom.current = true;
      setShowJump(false);
      setDraft('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      await refreshQueueState();
    }
  }

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    try {
      const channel = await createChannel(newChannel, data?.user.id ?? '');
      setNewChannel('');
      await refresh();
      setChannelId(channel.id);
      setMobileShowChannels(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create channel');
    } finally {
      await refreshQueueState();
    }
  }

  async function startDm(peerUserId: string) {
    try {
      const channel = await openDm(peerUserId, data?.user.id ?? '');
      setDmOpen(false);
      await refresh();
      setChannelId(channel.id);
      setMobileShowChannels(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open DM');
    } finally {
      await refreshQueueState();
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
        <p className="hint-li">Read receipts are unavailable until their data contract moves to Rodrigo.</p>

        <div className="sidebar-section">
          <h2>Channels</h2>
          {(queueState.pending + queueState.failed + queueState.conflicts + queueState.rejected) > 0 ? (
            <div className="events-inactive" role="status">
              <p>Messenger actions: {queueState.pending} pending, {queueState.failed} failed, {queueState.conflicts} conflicts, {queueState.rejected} rejected.</p>
              {queueState.pending + queueState.failed > 0 ? <button type="button" onClick={() => void resendMessengerActions().then(refreshQueueState).catch((err) => setError(err instanceof Error ? err.message : 'Resend failed'))}>Resend</button> : null}
              {queueState.conflicts + queueState.rejected > 0 ? <button type="button" onClick={() => void discardMessengerConflicts().then(refreshQueueState)}>Discard conflicts/rejections</button> : null}
            </div>
          ) : null}
          {data.load ? (
            <UserLoadSections
              load={data.load}
              empty="No channels you have joined."
              heading="h3"
              renderItems={(items) => (
                <ul className="channel-list">
                  {items.map((item) => (
                    <li key={`${item.workspaceId}:${item.value.id}`}>
                      <button
                        type="button"
                        className={item.value.id === channelId && item.workspaceId === data.workspace.id ? 'active' : undefined}
                        onClick={() => void selectChannel(item.value)}
                      >
                        <span aria-hidden>{item.value.kind === 'channel' ? '#' : '@'}</span>
                        {channelLabel(item.value, data.members, data.user.id)}
                        {item.value.kind === 'channel' && item.value.name === 'events' && data.events?.alive && item.workspaceId === data.workspace.id ? (
                          <em className="events-pill">live</em>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            />
          ) : null}
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

          <p className="hint-li">Direct messages are listed with their workspace above.</p>
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
                        </figure>
                      ) : null}
                      {msg.text ? (
                        <p className={system ? 'event-body' : undefined}>
                          {system ? renderMessageText(msg.text) : renderPingText(msg.text)}
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
          {suggestions.length > 0 ? (
            <ul
              id="messenger-mentions"
              className="mention-list"
              role="listbox"
              aria-label="People you can ping"
            >
              {suggestions.map((member, index) => (
                <li key={member.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    id={`messenger-mention-${member.id}`}
                    aria-selected={index === suggestionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseMention(member)}
                  >
                    {member.displayName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="attach"
            title="Image messages need Rodrigo blob storage"
            disabled
          >
            Photo unavailable
          </button>
          <textarea
            ref={composerRef}
            value={draft}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls="messenger-mentions"
            aria-activedescendant={
              suggestions[suggestionIndex]
                ? `messenger-mention-${suggestions[suggestionIndex].id}`
                : undefined
            }
            onChange={(event) => {
              setDraft(event.target.value);
              setCursor(event.target.selectionStart ?? event.target.value.length);
              setDismissedQuery('');
            }}
            onSelect={(event) => {
              const field = event.currentTarget;
              setCursor(field.selectionStart ?? field.value.length);
            }}
            placeholder={
              isEventsChannel
                ? 'Comment on an event…'
                : activeChannel?.kind === 'dm'
                  ? 'Direct message…'
                  : 'Message…'
            }
            rows={1}
            disabled={!channelId}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSuggestionIndex((index) => (index + 1) % suggestions.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSuggestions([]);
                  setDismissedQuery(mentionKey);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  if (isImeEnter(event)) return;
                  event.preventDefault();
                  const member = suggestions[suggestionIndex] ?? suggestions[0];
                  if (member) chooseMention(member);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isImeEnter(event)) return;
                event.preventDefault();
                void sendText();
              }
            }}
          />
          <button
            type="button"
            className="send"
            disabled={!draft.trim() || !channelId}
            onClick={() => void sendText()}
          >
            Send
          </button>
        </footer>
      </section>
    </div>
  );
}
