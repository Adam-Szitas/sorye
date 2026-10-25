'use client';

import {
  createKernelHost,
  startKernelSync,
  type KernelHost,
} from '@sorye/platform/host';
import type { HubSession } from '@sorye/types';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

const HubKernelContext = createContext<KernelHost | null>(null);

export function useHubKernelHost(): KernelHost | null {
  return useContext(HubKernelContext);
}

/**
 * Shell-owned kernel. Session and unread counts are pushed from the Hub shell.
 * Apps mounted under this provider receive a read-only client.
 */
export function HubKernelProvider({
  session,
  notificationUnread,
  activeAppId,
  children,
}: {
  session: HubSession | null;
  notificationUnread: number | null;
  activeAppId: string | null;
  children: ReactNode;
}) {
  const hostRef = useRef<KernelHost | null>(null);
  if (!hostRef.current) hostRef.current = createKernelHost();
  const host = hostRef.current;

  useEffect(() => {
    host.setSession(session);
  }, [host, session]);

  useEffect(() => {
    host.setNotificationUnread(notificationUnread);
  }, [host, notificationUnread]);

  useEffect(() => {
    host.setActiveAppId(activeAppId);
  }, [host, activeAppId]);

  return <HubKernelContext.Provider value={host}>{children}</HubKernelContext.Provider>;
}

/**
 * Full-page and embed mounts sit outside the shell. They still get a kernel
 * handle, filled from the same `/api/workspace` and `/api/notifications` routes.
 */
export function KernelSyncBoundary({
  appId,
  children,
}: {
  appId: string;
  children: ReactNode;
}) {
  const hostRef = useRef<KernelHost | null>(null);
  if (!hostRef.current) hostRef.current = createKernelHost();
  const host = hostRef.current;

  useEffect(() => {
    host.setActiveAppId(appId);
    return startKernelSync(host);
  }, [host, appId]);

  return <HubKernelContext.Provider value={host}>{children}</HubKernelContext.Provider>;
}
