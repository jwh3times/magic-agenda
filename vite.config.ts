import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/  +  https://vitest.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The plugin's auto-registration injects an INLINE script, which our
      // script-src 'self' CSP blocks. main.tsx registers explicitly instead.
      injectRegister: false,
      registerType: 'prompt',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      manifest: {
        // Must stay "Magic Agenda": it has to match the OAuth consent screen and the
        // index.html noscript block. Google's branding review is why that rule exists.
        name: 'Magic Agenda',
        short_name: 'Agenda',
        description:
          'A tactile, multi-user task board — a draggable sticky-note calendar that syncs across your devices.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0b0f1f',
        theme_color: '#0b0f1f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    // Deno tests, not Vitest tests — run with `deno test supabase/functions`.
    exclude: [...configDefaults.exclude, 'supabase/functions/**'],
    // Hermetic: tests never touch the real project (getSession is local-only anyway).
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
