import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { promises as dns } from 'node:dns';

/**
 * Outbound address checks for customer-supplied hosts (SSRF defence).
 *
 * Every address a host name resolves to must be public. Checks run when a
 * connection is saved and again on every socket the Hub opens (see
 * `guardedLookup` and `resolvePublicAddress`), so a DNS answer that changes
 * after validation (rebinding) is refused at connect time.
 */

const blocked = new BlockList();
// IPv4 special-purpose ranges (RFC 6890 and successors).
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
// IPv6 special-purpose ranges. Ranges that embed an IPv4 address are checked separately below.
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7],
  ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    if (isIP(maybeV4) !== 4) return null;
    const parts = maybeV4.split('.').map(Number);
    tail = [(parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!];
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...rest].map((part) => parseInt(part || '0', 16));
  if (groups.length !== 8 || groups.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  if (tail.length) groups.splice(6, 2, tail[0]!, tail[1]!);
  return groups;
}

function embeddedIpv4(groups: number[]): string | null {
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeroUntil = (n: number) => groups.slice(0, n).every((g) => g === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, deprecated)
  if (zeroUntil(5) && (groups[5] === 0xffff || groups[5] === 0)) return v4(groups[6]!, groups[7]!);
  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return v4(groups[6]!, groups[7]!);
  // 2002::/16 (6to4)
  if (groups[0] === 0x2002) return v4(groups[1]!, groups[2]!);
  // 2001:0::/32 (Teredo): client address is the bitwise inverse of the last 32 bits
  if (groups[0] === 0x2001 && groups[1] === 0) return v4(groups[6]! ^ 0xffff, groups[7]! ^ 0xffff);
  return null;
}

/** True only for addresses that are routable on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const groups = expandIpv6(address);
  if (!groups) return false;
  const inner = embeddedIpv4(groups);
  if (inner !== null && !isPublicAddress(inner)) return false;
  const normal = groups.map((g) => g.toString(16)).join(':');
  return !blocked.check(normal, 'ipv6');
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const SINGLE_LABEL_DEV_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A DNS name with at least one dot, or an IP literal. Lower-cases and strips a trailing dot. */
export function normalizeHost(raw: string, allowSingleLabel = false): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host.length > 253) return null;
  if (isIP(host)) return host;
  if (HOSTNAME_RE.test(host)) return host;
  if (allowSingleLabel && SINGLE_LABEL_DEV_RE.test(host)) return host;
  return null;
}

export class HostNotAllowedError extends Error {
  constructor(readonly reason: 'host_not_allowed' | 'host_unresolved') {
    super(reason);
    this.name = 'HostNotAllowedError';
  }
}

const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Resolve a host and require every answer to be public (unless `allowPrivate`).
 * Returns the address to connect to, so callers can pin the connection to it.
 */
export async function resolvePublicAddress(host: string, allowPrivate: boolean): Promise<{ address: string; family: 4 | 6 }> {
  const literal = isIP(host);
  if (literal) {
    if (!allowPrivate && !isPublicAddress(host)) throw new HostNotAllowedError('host_not_allowed');
    return { address: host, family: literal as 4 | 6 };
  }
  let answers: LookupAddress[];
  try {
    answers = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS).unref()),
    ]);
  } catch {
    throw new HostNotAllowedError('host_unresolved');
  }
  if (answers.length === 0) throw new HostNotAllowedError('host_unresolved');
  if (!allowPrivate && answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new HostNotAllowedError('host_not_allowed');
  }
  const first = answers[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` for http(s) agents: resolves like Node does, then refuses the
 * socket when any answer is not public. Used for every request to a
 * customer S3 endpoint.
 */
export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '');
      const list = addresses as LookupAddress[];
      if (!allowPrivate && (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address)))) {
        const refused = Object.assign(new Error('Address not allowed'), { code: 'EHOSTNOTALLOWED' }) as NodeJS.ErrnoException;
        return callback(refused, '');
      }
      if (options.all) return callback(null, list);
      const first = list[0]!;
      return callback(null, first.address, first.family);
    });
  };
}
