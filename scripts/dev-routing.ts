import type { ProxyOptions } from 'vite'

export const CLOUD_RESEARCH_DEV_ORIGIN = 'http://127.0.0.1:8788'
export const LEGACY_API_DEV_ORIGIN = 'http://127.0.0.1:3000'

export function createDevProxy(): Record<string, string | ProxyOptions> {
  return {
    '^/api/research(?:/|$)': {
      target: CLOUD_RESEARCH_DEV_ORIGIN,
      changeOrigin: true,
    },
    '/api': {
      target: LEGACY_API_DEV_ORIGIN,
      changeOrigin: true,
    },
  }
}
