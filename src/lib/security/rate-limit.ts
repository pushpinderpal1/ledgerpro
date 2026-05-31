/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for single-instance deployments (Railway, ECS Fargate single task).
 * Move to Redis for multi-instance horizontal scaling.
 *
 * Tracks attempts in two dimensions per identifier:
 *   - short window (anti-brute-force, e.g. 5 attempts / 1 min)
 *   - long window (slow throttle, e.g. 20 attempts / 1 hour)
 */

interface Bucket {
  short: number[]   // timestamps within short window
  long: number[]    // timestamps within long window
  blockedUntil?: number
}

const store = new Map<string, Bucket>()

// Periodic cleanup so the map doesn't grow unbounded.
let cleanupInterval: ReturnType<typeof setInterval> | null = null
function startCleanup() {
  if (cleanupInterval || typeof setInterval === 'undefined') return
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    const cutoff = now - 60 * 60 * 1000 // 1h ago
    for (const [k, b] of store) {
      b.long = b.long.filter((t) => t > cutoff)
      b.short = b.short.filter((t) => t > now - 60 * 1000)
      if (b.long.length === 0 && (!b.blockedUntil || b.blockedUntil < now)) {
        store.delete(k)
      }
    }
  }, 60 * 1000)
  // Don't keep process alive just for the cleanup.
  if (typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    ;(cleanupInterval as unknown as { unref: () => void }).unref()
  }
}

export interface RateLimitOptions {
  shortWindowMs?: number
  shortMax?: number
  longWindowMs?: number
  longMax?: number
  blockMs?: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  reason?: 'short' | 'long' | 'blocked'
}

const DEFAULTS: Required<RateLimitOptions> = {
  shortWindowMs: 60 * 1000,           // 1 minute
  shortMax: 5,                         // 5 attempts / min
  longWindowMs: 60 * 60 * 1000,        // 1 hour
  longMax: 20,                         // 20 attempts / hour
  blockMs: 15 * 60 * 1000,             // 15 minute lockout after burst
}

export function checkRateLimit(
  identifier: string,
  opts: RateLimitOptions = {}
): RateLimitResult {
  startCleanup()
  const o = { ...DEFAULTS, ...opts }
  const now = Date.now()
  const b = store.get(identifier) ?? { short: [], long: [] }

  if (b.blockedUntil && b.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((b.blockedUntil - now) / 1000),
      reason: 'blocked',
    }
  }
  if (b.blockedUntil && b.blockedUntil <= now) b.blockedUntil = undefined

  // Trim expired entries first.
  b.short = b.short.filter((t) => t > now - o.shortWindowMs)
  b.long = b.long.filter((t) => t > now - o.longWindowMs)

  if (b.short.length >= o.shortMax) {
    b.blockedUntil = now + o.blockMs
    store.set(identifier, b)
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(o.blockMs / 1000), reason: 'short' }
  }
  if (b.long.length >= o.longMax) {
    store.set(identifier, b)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(o.longWindowMs / 1000),
      reason: 'long',
    }
  }

  return { allowed: true, remaining: o.shortMax - b.short.length, retryAfterSeconds: 0 }
}

/** Call after a failed attempt to count it against the bucket. */
export function recordFailure(identifier: string) {
  const now = Date.now()
  const b = store.get(identifier) ?? { short: [], long: [] }
  b.short.push(now)
  b.long.push(now)
  store.set(identifier, b)
}

/** Clear the bucket on successful login. */
export function clearFailures(identifier: string) {
  store.delete(identifier)
}

/** Best-effort client identifier from headers. */
export function clientKey(req: Request, suffix: string = ''): string {
  const fwd = req.headers.get('x-forwarded-for')
  const real = req.headers.get('x-real-ip')
  const ip = fwd?.split(',')[0]?.trim() || real || 'unknown'
  return suffix ? `${ip}:${suffix}` : ip
}

// Exposed for tests.
export const __testing = { store }
