const parseSinceDurationMs = (since) => {
  const match = String(since || '').trim().match(/^(\d+)([hd])$/i);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  return value * (match[2].toLowerCase() === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
};

export function filterNewsItemsSince(items, since, { nowMs = Date.now() } = {}) {
  const cutoffMs = nowMs - parseSinceDurationMs(since);
  const futureToleranceMs = 5 * 60 * 1000;

  return items.filter((item) => {
    const rawTime = item?.published_at || item?.published_dt || item?.time;
    if (!rawTime) return true;
    const itemMs = Date.parse(rawTime);
    if (!Number.isFinite(itemMs)) return true;
    return itemMs >= cutoffMs && itemMs <= nowMs + futureToleranceMs;
  });
}
