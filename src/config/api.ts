const explicitApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();

function normalizeApiBase(base: string): string {
  if (!base) return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function isLocalHostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isLocalHostName(url.hostname);
  } catch {
    return isLocalHostName(value);
  }
}

// In production and LAN access, default to same-origin /api so phones can access the same backend.
// In local-only localhost dev, keep explicit localhost fallback unless an explicit local-only base is used from remote clients.
const defaultApiBase = (() => {
  const isBrowser = typeof window !== 'undefined' && typeof window.location !== 'undefined';
  if (!isBrowser || import.meta.env.DEV) {
    if (!isBrowser || isLocalHostName(window.location.hostname)) {
      return 'http://localhost:3000';
    }
    return '';
  }
  return '';
})();

export const API_BASE = normalizeApiBase(
  explicitApiBase
    ? (() => {
      const isBrowser = typeof window !== 'undefined' && typeof window.location !== 'undefined';
      if (isBrowser && isLocalhostUrl(explicitApiBase) && !isLocalHostName(window.location.hostname)) {
        return defaultApiBase;
      }
      return explicitApiBase;
    })()
    : defaultApiBase,
);
