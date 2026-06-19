import { ApiError } from "@/server/api/errors";

const PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS = 60_000;
const PUBLIC_LEAD_RATE_LIMIT_MAX_REQUESTS = 30;

type RateLimitBucket = {
  resetAt: number;
  count: number;
};

const publicLeadRateLimitBuckets = new Map<string, RateLimitBucket>();

function getBucketKey(ip: string | null) {
  return ip?.trim() || "anonymous";
}

function pruneExpiredBuckets(now: number) {
  for (const [key, bucket] of publicLeadRateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      publicLeadRateLimitBuckets.delete(key);
    }
  }
}

export function consumePublicLeadRateLimit(params: {
  ip: string | null;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const key = getBucketKey(params.ip);

  pruneExpiredBuckets(now);

  const existing = publicLeadRateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    publicLeadRateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS,
    });

    return;
  }

  if (existing.count >= PUBLIC_LEAD_RATE_LIMIT_MAX_REQUESTS) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many public lead submissions. Please retry later.",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      },
    );
  }

  existing.count += 1;
  publicLeadRateLimitBuckets.set(key, existing);
}

export function resetPublicLeadRateLimitState() {
  publicLeadRateLimitBuckets.clear();
}
