export interface NewsFeedFreshnessPayload {
  createdAt?: string | null;
  lastUpdated?: string | null;
  lastCheckedAt?: string | null;
  latestNewsAt?: string | null;
  contentStale?: boolean;
}

export function readNewsFeedFreshness(payload?: NewsFeedFreshnessPayload | null) {
  return {
    lastUpdated: payload?.lastUpdated || payload?.createdAt || null,
    lastCheckedAt: payload?.lastCheckedAt || null,
    latestNewsAt: payload?.latestNewsAt || null,
    contentStale: payload?.contentStale ?? !payload?.latestNewsAt,
  };
}
