import { redis } from "../utils/redis.js";
import { logger } from "../utils/logger.js";

/**
 * Per-provider rate limiting for outbound price-source requests.
 *
 * State lives in Redis so the limit is shared across every worker/instance
 * that calls the same provider, while unrelated providers keep their own
 * independent counters. Uses the same Redis sliding-window technique as the
 * HTTP rate-limit middleware (`src/api/middleware/rateLimit.middleware.ts`):
 * a sorted set keyed per provider whose members are request timestamps. The
 * key self-expires once the window has fully passed, so state cannot grow
 * without bound.
 */

export interface ProviderRateLimitConfig {
  providerKey: string;
  maxRequests: number;
  windowMs: number;
}

export interface ProviderRateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterMs: number;
}

const SLIDING_WINDOW_SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])

-- Evict entries that have left the sliding window.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

local current = tonumber(redis.call('ZCARD', key))

if current >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_ms = now + window
  if oldest and oldest[2] then
    reset_ms = tonumber(oldest[2]) + window
  end
  return {0, current, reset_ms, limit}
end

-- Use Redis server time for a microsecond-granularity unique member.
local t      = redis.call('TIME')
local member = tostring(now) .. ':' .. tostring(t[2])

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 1000)

return {1, current + 1, now + window, limit}
`;

export class ProviderRateLimiterService {
  /**
   * Atomically checks and records a request against the provider's window.
   * Returns whether the request is allowed plus window metadata.
   */
  async checkLimit(config: ProviderRateLimitConfig): Promise<ProviderRateLimitResult> {
    const now = Date.now();
    const key = `bw:provider:rl:${config.providerKey}`;

    try {
      const raw = (await redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        String(now),
        String(config.windowMs),
        String(config.maxRequests)
      )) as [number, number, number, number];

      const [allowed, current, resetMs, limit] = raw;

      return {
        allowed: allowed === 1,
        current,
        limit,
        remaining: Math.max(0, limit - current),
        resetMs,
        retryAfterMs: allowed === 0 ? Math.max(0, resetMs - now) : 0,
      };
    } catch (err) {
      // Fail open on Redis errors: never let a rate-limit outage block price
      // collection entirely.
      logger.warn(
        { err, providerKey: config.providerKey },
        "Provider rate limit Redis error — failing open"
      );
      return {
        allowed: true,
        current: 0,
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetMs: now + config.windowMs,
        retryAfterMs: 0,
      };
    }
  }
}

export const providerRateLimiterService = new ProviderRateLimiterService();
