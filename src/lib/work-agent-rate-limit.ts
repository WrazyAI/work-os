/** Per-token request budget. The deployment is a single web instance, so an
 * in-memory window is sufficient; a shared limiter is a follow-up if the app
 * scales out. A batch counts as one request and one write. */

export const AGENT_RATE_LIMIT_WINDOW_MS = 60_000;
export const AGENT_RATE_LIMIT_MAX_REQUESTS = 120;
export const AGENT_RATE_LIMIT_MAX_WRITES = 20;

export class AgentRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super(`Rate limit exceeded; retry after ${retryAfter} seconds`);
    this.name = "AgentRateLimitError";
    this.retryAfter = retryAfter;
  }
}

type Bucket = { windowStart: number; requests: number; writes: number };

const buckets = new Map<string, Bucket>();

export function assertAgentRateLimit(tokenId: string, write: boolean, now = new Date()): void {
  const at = now.getTime();
  let bucket = buckets.get(tokenId);
  if (!bucket || at - bucket.windowStart >= AGENT_RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: at, requests: 0, writes: 0 };
    buckets.set(tokenId, bucket);
  }
  if (bucket.requests >= AGENT_RATE_LIMIT_MAX_REQUESTS || (write && bucket.writes >= AGENT_RATE_LIMIT_MAX_WRITES)) {
    const retryAfter = Math.max(1, Math.ceil((bucket.windowStart + AGENT_RATE_LIMIT_WINDOW_MS - at) / 1000));
    throw new AgentRateLimitError(retryAfter);
  }
  bucket.requests += 1;
  if (write) bucket.writes += 1;
}
