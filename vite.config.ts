import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Skip the "computing gzip size" step. On small EC2 instances (1-2 GB RAM)
    // this final step silently OOM-kills the build after chunks are written.
    // The gzip numbers are cosmetic; raw chunk sizes are still reported.
    reportCompressedSize: false,
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['.claude/**', '.claire/**', 'node_modules/**'],
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_GOOGLE_PLACES_KEY: 'test-google-key',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_stub',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/lib/geo.ts',
        'src/lib/fare.ts',
        'src/stores/**/*.ts',
        'server/routes/**/*.ts',
        'server/lib/**/*.ts',
      ],
    },
  },
})
