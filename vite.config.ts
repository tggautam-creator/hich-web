import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

/**
 * Inject Firebase config into `public/firebase-messaging-sw.js` at
 * dev-serve time AND build time. The SW is a static file (Vite can't
 * use `import.meta.env` inside it), so we rewrite the placeholders
 * `__FIREBASE_*__` with values from `loadEnv()` whenever the SW is
 * served or copied to `dist/`.
 *
 * Modes:
 *   - `npm run dev` (--mode dev) → reads `.env` + `.env.dev` → dev Firebase project
 *   - `npm run build`            → reads `.env` + `.env.production` (falls back to `.env`)
 *                                  → prod Firebase project
 *
 * Without this plugin, the SW would hardcode one project's config and
 * the OTHER mode would register FCM tokens against the wrong Firebase
 * project — exactly the cross-project bug iOS hit and fixed via the
 * runtime `preconditionFailure` in `AppDelegate`. See WEB_PARITY_REPORT
 * W-T0-5.
 */
function firebaseMessagingSwEnvPlugin(env: Record<string, string>): Plugin {
  const replacements: Record<string, string> = {
    __FIREBASE_API_KEY__: env['VITE_FIREBASE_API_KEY'] ?? '',
    __FIREBASE_AUTH_DOMAIN__: env['VITE_FIREBASE_AUTH_DOMAIN'] ?? '',
    __FIREBASE_PROJECT_ID__: env['VITE_FIREBASE_PROJECT_ID'] ?? '',
    __FIREBASE_MESSAGING_SENDER_ID__: env['VITE_FIREBASE_MESSAGING_SENDER_ID'] ?? '',
    __FIREBASE_APP_ID__: env['VITE_FIREBASE_APP_ID'] ?? '',
  }
  function applyReplacements(src: string): string {
    let out = src
    for (const [key, value] of Object.entries(replacements)) {
      out = out.split(key).join(value)
    }
    return out
  }
  return {
    name: 'firebase-messaging-sw-env',
    configureServer(server) {
      // Intercept GET /firebase-messaging-sw.js during `npm run dev`.
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/firebase-messaging-sw.js') return next()
        const swPath = path.resolve(__dirname, 'public/firebase-messaging-sw.js')
        try {
          const src = fs.readFileSync(swPath, 'utf-8')
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.setHeader('Service-Worker-Allowed', '/')
          res.end(applyReplacements(src))
        } catch (err) {
          next(err as Error)
        }
      })
    },
    writeBundle(options) {
      // Vite copies `public/*` to `dist/*` unchanged. After the bundle
      // is written, rewrite the SW with the resolved env values.
      const outDir = options.dir ?? path.resolve(__dirname, 'dist')
      const swOutPath = path.join(outDir, 'firebase-messaging-sw.js')
      if (!fs.existsSync(swOutPath)) return
      const src = fs.readFileSync(swOutPath, 'utf-8')
      fs.writeFileSync(swOutPath, applyReplacements(src))
    },
  }
}

/**
 * Fail-fast guards. When mode === 'production' (i.e. `npm run build`
 * triggered by Vercel auto-deploy on push, or run locally) the
 * client-side infrastructure pointers MUST resolve to the prod
 * project. Otherwise we emit a webapp that talks to dev infrastructure
 * even though it gets deployed to www.tagorides.com.
 *
 * Checked here: `VITE_SUPABASE_URL` + `VITE_FIREBASE_PROJECT_ID` — the
 * two pointers that absolutely must be prod on a prod build.
 *
 * NOT checked here: `VITE_STRIPE_PUBLISHABLE_KEY`. Per CLAUDE.md, the
 * webapp MVP runs on Stripe test mode; iOS Release flips to live keys
 * via `Tago.Release.xcconfig`. The server-side `STRIPE_SECRET_KEY`
 * guard in `server/index.ts` is the hard rule for prod payment
 * correctness — Vite-side enforcement here would block legitimate
 * web-MVP builds.
 */
function assertProdEnv(mode: string, env: Record<string, string>) {
  if (mode !== 'production') return
  const supabaseUrl = env['VITE_SUPABASE_URL'] ?? ''
  const firebaseProject = env['VITE_FIREBASE_PROJECT_ID'] ?? ''

  const problems: string[] = []
  if (supabaseUrl.includes('krcwdzwqahcpqsoauttf')) {
    problems.push(`VITE_SUPABASE_URL points at dev project (${supabaseUrl})`)
  } else if (!supabaseUrl.includes('pdxtswlaxqbqkrfwailf')) {
    problems.push(`VITE_SUPABASE_URL=${supabaseUrl} is neither the dev nor known prod project`)
  }
  if (firebaseProject === 'tago-dev-e3ade') {
    problems.push(`VITE_FIREBASE_PROJECT_ID=tago-dev-e3ade is the DEV project; prod is hich-6f501`)
  }

  if (problems.length > 0) {
    /* eslint-disable no-console */
    console.error('\n[31m[1m[FATAL] Production build attempted with dev/test env values:[0m')
    for (const p of problems) console.error(`  • ${p}`)
    console.error(
      '\nFix: either pass `--mode dev` for a dev build, or update the env so prod values resolve.',
    )
    console.error(
      'On Vercel: Settings → Environment Variables → make sure prod env is set on the Production environment.\n',
    )
    /* eslint-enable no-console */
    process.exit(1)
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `prefix=''` to load every key (we need VITE_* AND any other dotenv vars).
  const env = loadEnv(mode, process.cwd(), '')
  assertProdEnv(mode, env)
  return ({
  plugins: [react(), firebaseMessagingSwEnvPlugin(env)],
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
})
