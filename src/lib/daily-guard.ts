/* Daily abuse guardrails for the Cloud Run background-removal service.
 *
 * The Cloud Run free tier bills memory for the full instance lifetime,
 * including the ~15-minute idle tail before an instance scales to zero. Two
 * caps keep a public deployment inside the free tier:
 *
 *  - BG_WAKEUP_LIMIT: max cold boots (scale-to-zero -> boot) per UTC day. Each
 *    boot carries its own fresh 15-minute idle tail.
 *  - BG_WORK_MINUTES_LIMIT: max billable minutes per UTC day, measured as the
 *    union of every [request, request + 15min] interval. A "session" stays open
 *    from its first request until 15 minutes after its last.
 *
 * Both live in one atomic Lua read-modify-write so concurrent serverless
 * instances can't each pass the cap. State is keyed by UTC day and expires
 * after 48h (covers a day rollover without stranding "yesterday").
 *
 * Shared state needs Upstash to be reliable across instances; without it we
 * fall back to a per-process map, which is only trustworthy in local dev. */

import { Redis } from "@upstash/redis";

const WAKEUP_LIMIT = Number(process.env.BG_WAKEUP_LIMIT ?? "4");
const WORK_MINUTES_LIMIT = Number(process.env.BG_WORK_MINUTES_LIMIT ?? "60");
const WORK_LIMIT_MS = WORK_MINUTES_LIMIT * 60 * 1000;

/** Cloud Run keeps an idle instance alive for up to ~15 minutes before scaling
 *  it to zero. A request therefore bills at least this much memory time. */
const IDLE_TAIL_MS = 15 * 60 * 1000;

const KEY_TTL_SECONDS = 48 * 60 * 60;

const upstashConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = upstashConfigured ? Redis.fromEnv() : null;

function utcDay(): string {
  const d = new Date();
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export type DailyGate =
  | { allowed: true }
  | { allowed: false; reason: "wakeup" | "work" };

/* State per day: "accruedMs,sessionStart,activeUntil,wakeups".
 *  - accruedMs: fully-closed sessions' total length.
 *  - sessionStart: start of the currently-open session.
 *  - activeUntil: currently-open session's projected end (last request + tail).
 *  - wakeups: cold boots counted today. */
const WORK_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local tail = tonumber(ARGV[2])
local workLimit = tonumber(ARGV[3])
local wakeLimit = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local accrued = 0
local sessionStart = now
local activeUntil = now + tail
local wakeups = 0
local newSession = true

if raw then
  local a, s, e, w = raw:match("^(%d+),(%d+),(%d+),(%d+)$")
  if a then
    accrued = tonumber(a)
    local oldStart = tonumber(s)
    local oldActiveUntil = tonumber(e)
    wakeups = tonumber(w)
    if now <= oldActiveUntil then
      newSession = false
      sessionStart = oldStart
    else
      accrued = accrued + (oldActiveUntil - oldStart)
    end
    activeUntil = now + tail
  end
end

if newSession then
  wakeups = wakeups + 1
  if wakeups > wakeLimit then
    return -1
  end
end

local total = accrued + (activeUntil - sessionStart)
if total > workLimit then
  return -2
end

redis.call('SET', key, accrued .. ',' .. sessionStart .. ',' .. activeUntil .. ',' .. wakeups, 'EX', 172800)
return 1
`;

async function allowUpstash(key: string): Promise<DailyGate> {
  try {
    const result = await redis!.eval<[string, string, string, string], number>(
      WORK_SCRIPT,
      [key],
      [String(Date.now()), String(IDLE_TAIL_MS), String(WORK_LIMIT_MS), String(WAKEUP_LIMIT)],
    );
    if (result === 1) return { allowed: true };
    if (result === -1) return { allowed: false, reason: "wakeup" };
    return { allowed: false, reason: "work" };
  } catch {
    // Fail open: a transient Redis outage shouldn't take the feature down.
    return { allowed: true };
  }
}

interface MemState {
  accrued: number;
  sessionStart: number;
  activeUntil: number;
  wakeups: number;
}

const memState = new Map<string, MemState>();

function allowMemory(key: string): DailyGate {
  const now = Date.now();
  const prev = memState.get(key);
  let accrued = 0;
  let sessionStart = now;
  let activeUntil = now + IDLE_TAIL_MS;
  let wakeups = 0;
  let newSession = true;

  if (prev) {
    accrued = prev.accrued;
    wakeups = prev.wakeups;
    if (now <= prev.activeUntil) {
      newSession = false;
      sessionStart = prev.sessionStart;
    } else {
      accrued += prev.activeUntil - prev.sessionStart;
    }
    activeUntil = now + IDLE_TAIL_MS;
  }

  if (newSession) {
    wakeups += 1;
    if (wakeups > WAKEUP_LIMIT) return { allowed: false, reason: "wakeup" };
  }

  const total = accrued + (activeUntil - sessionStart);
  if (total > WORK_LIMIT_MS) return { allowed: false, reason: "work" };

  memState.set(key, { accrued, sessionStart, activeUntil, wakeups });
  return { allowed: true };
}

/** Decide whether today's request may touch the upstream service, accruing the
 *  request's idle tail if allowed. Called before any upstream call so a
 *  rejected request never wakes the instance. */
export async function allowToday(): Promise<DailyGate> {
  const key = `pixora:bg-day:${utcDay()}`;
  if (redis) return allowUpstash(key);
  return allowMemory(key);
}
