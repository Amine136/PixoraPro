import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/* Per-IP rate limiting for /api/remove-bg.
 *
 * The proxy is the one thing on this deployment that costs money to call, so
 * it is the one thing worth throttling. Turnstile proves "human"; this caps how
 * many times even a human (or a determined bot passing Turnstile) can hit the
 * segmentation service in an hour.
 *
 * Two backends:
 *  - Upstash Redis (production): shared across all serverless instances and
 *    cold starts, so the counter is real. Requires UPSTASH_REDIS_REST_URL and
 *    UPSTASH_REDIS_REST_TOKEN (free tier is fine).
 *  - In-memory fallback (local dev): a per-process sliding window. It is NOT a
 *    reliable limit on Vercel — instances are ephemeral and may run several at
 *    once — so production should always configure Upstash. */

/** Requests allowed per IP per hour. Tune with REMOVE_BG_RATE_LIMIT if needed. */
const MAX_PER_HOUR = Number(process.env.REMOVE_BG_RATE_LIMIT ?? "10");
const WINDOW_MS = 60 * 60 * 1000;

const upstashConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const upstash = upstashConfigured
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(MAX_PER_HOUR, "1 h"),
      prefix: "pixora:remove-bg",
    })
  : null;

/* In-memory sliding window: timestamps per IP, pruned on read. */
const hits = new Map<string, number[]>();

function inMemoryAllow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_HOUR) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

/** Returns true when the IP may proceed. Null IP (rare, e.g. no forwarded
 *  header) is allowed through — Turnstile is still the primary gate. */
export async function checkRateLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  if (upstash) {
    const { success } = await upstash.limit(ip);
    return success;
  }
  return inMemoryAllow(ip);
}
