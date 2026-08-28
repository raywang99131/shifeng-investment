import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createDevProxy } from './scripts/dev-routing.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: createDevProxy(),
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
