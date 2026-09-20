const DEFAULT_NEWS_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function getNewsArchiveFreshness(data, {
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_NEWS_STALE_AFTER_MS,
} = {}) {
  let latestNewsMs = null;

  (data?.entries || []).forEach((entry) => {
    if (entry?.type === 'price-watch') return;
    (entry?.news || []).forEach((item) => {
      if (item?.collectionChannel === 'price-watch') return;
      const itemMs = Date.parse(item?.time || item?.publishedAt || '');
      if (!Number.isFinite(itemMs)) return;
      if (latestNewsMs === null || itemMs > latestNewsMs) latestNewsMs = itemMs;
    });
  });

  return {
    latestNewsAt: latestNewsMs === null ? null : new Date(latestNewsMs).toISOString(),
    lastCheckedAt: data?.lastCheckedAt || null,
    contentStale: latestNewsMs === null || nowMs - latestNewsMs > staleAfterMs,
  };
}

export function getNewsIncrementalSince(data, { nowMs = Date.now() } = {}) {
  const freshness = getNewsArchiveFreshness(data, { nowMs });
  const referenceTime = freshness.contentStale && freshness.latestNewsAt
    ? freshness.latestNewsAt
    : data?.lastCheckedAt || data?.lastUpdated || freshness.latestNewsAt;
  const referenceMs = Date.parse(referenceTime || '');
  if (!Number.isFinite(referenceMs)) return '24h';

  const diffMs = nowMs - referenceMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '1h';

  const lookbackMs = diffMs + 10 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (lookbackMs < dayMs) return `${Math.max(1, Math.ceil(lookbackMs / hourMs))}h`;
  return `${Math.min(7, Math.max(1, Math.ceil(lookbackMs / dayMs)))}d`;
}

export { DEFAULT_NEWS_STALE_AFTER_MS };
