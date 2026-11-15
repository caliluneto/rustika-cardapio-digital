import { isIPv4, isIPv6 } from 'node:net';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../middleware/errorHandler';

/** Default number of tracked keys per store. Each entry holds a short key plus two numbers. */
export const DEFAULT_LIMIT_CAPACITY = 10000;

export interface RateLimitResult { limited: boolean; retryAfterSeconds: number }

export interface FixedWindowLimiter {
  /** Counts one event for the key and reports whether it exceeded the limit. */
  hit(key: string): RateLimitResult;
  /** Reports whether the key already reached the limit, without counting. */
  peek(key: string): RateLimitResult;
  /** Total tracked keys (active + blocked). */
  readonly size: number;
  /** Keys that reached the limit and are protected from eviction by churn. */
  readonly blockedSize: number;
}

interface Entry { count: number; until: number }

/**
 * Fixed-window, bounded, per-process counter with two stores:
 *
 * - `active`: keys below the limit. When full of live entries, the oldest one is evicted, so a
 *   full table never blocks a new, unrelated client.
 * - `blocked`: keys that reached the limit. They are never evicted by new keys arriving in
 *   `active`; flooding the limiter with fresh keys therefore cannot reset an abuser's counter
 *   (a versão anterior podia ser reiniciada dessa forma). If `blocked` itself fills up, expired entries
 *   are swept and, if still full, the entry whose penalty ends first gives way. Filling it costs
 *   `max` requests per key, so the O(n) sweep is paid by the abuser, not by normal traffic.
 *
 * In `active` all entries share the same window length, so Map insertion order is expiry order
 * and expired entries are purged from the front in O(expired).
 * Counters live in process memory: a restart clears them (documented in docs/orders-api.md).
 */
export function createFixedWindowLimiter(options: {
  max: number; windowMs: number; now: () => Date; capacity?: number; blockedCapacity?: number;
}): FixedWindowLimiter {
  const { max, windowMs, now } = options;
  const capacity = options.capacity ?? DEFAULT_LIMIT_CAPACITY;
  const blockedCapacity = options.blockedCapacity ?? capacity;
  if (!Number.isInteger(max) || max < 1 || !(windowMs > 0) || !Number.isInteger(capacity) || capacity < 1 ||
      !Number.isInteger(blockedCapacity) || blockedCapacity < 1) {
    throw new Error('Configuração de limite inválida.');
  }
  const active = new Map<string, Entry>();
  const blocked = new Map<string, Entry>();
  // Blocked entries are unordered; expired ones are swept at most once per interval (O(n) amortized).
  const sweepIntervalMs = Math.min(windowMs, 1000);
  let nextBlockedSweep = -Infinity;
  function sweepBlocked(time: number) {
    if (time < nextBlockedSweep) return;
    nextBlockedSweep = time + sweepIntervalMs;
    for (const [key, entry] of blocked) if (entry.until <= time) blocked.delete(key);
  }

  function purge(store: Map<string, Entry>, time: number) {
    for (const [key, entry] of store) {
      if (entry.until > time) break;
      store.delete(key);
    }
  }
  function live(key: string, time: number): Entry | undefined {
    for (const store of [blocked, active]) {
      const entry = store.get(key);
      if (!entry) continue;
      if (entry.until <= time) { store.delete(key); return undefined; }
      return entry;
    }
    return undefined;
  }
  function evictOldest(store: Map<string, Entry>) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  /** Blocked entries are not kept in expiry order; they are swept only when the store is full. */
  function makeRoomInBlocked(time: number) {
    if (blocked.size < blockedCapacity) return;
    let soonestKey: string | undefined; let soonest = Infinity;
    for (const [key, entry] of blocked) {
      if (entry.until <= time) { blocked.delete(key); continue; }
      if (entry.until < soonest) { soonest = entry.until; soonestKey = key; }
    }
    if (blocked.size >= blockedCapacity && soonestKey !== undefined) blocked.delete(soonestKey);
  }
  const result = (limited: boolean, until: number, time: number): RateLimitResult => ({
    limited, retryAfterSeconds: Math.max(1, Math.ceil((until - time) / 1000)),
  });

  return {
    hit(key) {
      const time = now().getTime();
      purge(active, time); sweepBlocked(time);
      let entry = live(key, time);
      if (!entry) {
        while (active.size >= capacity) evictOldest(active);
        entry = { count: 0, until: time + windowMs };
        active.set(key, entry);
      }
      entry.count += 1;
      if (entry.count >= max && active.has(key)) {
        // Reached the limit: move to the protected store, keeping the original window.
        active.delete(key);
        makeRoomInBlocked(time);
        blocked.set(key, entry);
      }
      return result(entry.count > max, entry.until, time);
    },
    peek(key) {
      const time = now().getTime();
      const entry = live(key, time);
      if (!entry) return { limited: false, retryAfterSeconds: 0 };
      return result(entry.count >= max, entry.until, time);
    },
    get size() { return active.size + blocked.size; },
    get blockedSize() { return blocked.size; },
  };
}

export function tooManyRequests(response: Response, retryAfterSeconds: number): AppError {
  response.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return new AppError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Aguarde antes de tentar novamente.');
}

/**
 * Rate-limit key for a client address. IPv4-mapped IPv6 becomes plain IPv4, and IPv6 is reduced
 * to its /64 prefix: one subscriber usually controls a whole /64, so per-address keys would let a
 * single client mint billions of fresh buckets. Forwarding headers are never trusted.
 */
export function rateLimitAddress(address: string | undefined): string {
  if (!address) return 'unknown';
  const value = address.trim().toLowerCase();
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(value)) return value;
  const bare = value.split('%')[0]!;
  if (!isIPv6(bare)) return value;
  return `${expandIPv6(bare).slice(0, 4).join(':')}::/64`;
}

function expandIPv6(address: string): string[] {
  let text = address;
  const ipv4Tail = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const parts = ipv4Tail[1]!.split('.').map(Number);
    text = text.slice(0, -ipv4Tail[1]!.length) + `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array<string>(missing).fill('0'), ...tailParts].map((part) => (parseInt(part, 16) || 0).toString(16));
}

export const clientAddress = (request: Request): string => rateLimitAddress(request.ip ?? request.socket.remoteAddress);

/** Per-IP middleware used by the access routes. */
export function accessLimit(max: number, windowMs: number, now: () => Date, capacity?: number): RequestHandler {
  const limiter = createFixedWindowLimiter({ max, windowMs, now, capacity });
  return (request, response, next) => {
    const { limited, retryAfterSeconds } = limiter.hit(clientAddress(request));
    if (limited) return next(tooManyRequests(response, retryAfterSeconds));
    next();
  };
}
