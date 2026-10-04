// lib/rateLimit.ts
// In-process rate limiter — no Redis required.
// Supports independent buckets per IP and per wallet address.
//
// Usage:
//   const result = ipLimiter.check(ip);
//   if (!result.ok) return 429;
//
// In production, swap with a Redis-backed limiter (e.g. @upstash/ratelimit)
// by replacing the Map with Redis INCRex commands — the interface is identical.

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;

    // Periodically purge expired buckets to avoid memory leaks
    setInterval(() => {
      const now = Date.now();
      for (const [key, b] of this.buckets.entries()) {
        if (now >= b.resetAt) this.buckets.delete(key);
      }
    }, windowMs * 2).unref?.(); // .unref() lets Node exit even if timer is pending
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count++;

    return {
      ok: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  /** Manually reset a key (e.g. after a successful auth) */
  reset(key: string): void {
    this.buckets.delete(key);
  }
}

// ── Pre-configured limiters ────────────────────────────────────────────────

/** Nonce endpoint: 10 requests / 60 s per IP */
export const nonceIpLimiter = new InMemoryRateLimiter(10, 60_000);

/** Nonce endpoint: 5 requests / 60 s per wallet address */
export const nonceWalletLimiter = new InMemoryRateLimiter(5, 60_000);

/** Verify endpoint: 10 attempts / 60 s per IP */
export const verifyIpLimiter = new InMemoryRateLimiter(10, 60_000);

/** Verify endpoint: 5 failed attempts / 15 min per wallet — blocks brute-force */
export const verifyWalletLimiter = new InMemoryRateLimiter(5, 15 * 60_000);

/** Generic API: 120 requests / 60 s per IP (applied at middleware) */
export const apiIpLimiter = new InMemoryRateLimiter(120, 60_000);

/** Helper: build a 429 response body */
export function rateLimitResponse(resetAt: number) {
  const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);
  return {
    error: "Too many requests.",
    retryAfter: retryAfterSec,
  };
}
