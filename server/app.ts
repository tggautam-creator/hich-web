import express, { type Request, type Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import { ridesRouter } from './routes/rides.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { scheduleRouter } from './routes/schedule.ts'
import { transitRouter } from './routes/transit.ts'
import { directionsRouter } from './routes/directions.ts'
import { messagesRouter } from './routes/messages.ts'
import { walletRouter } from './routes/wallet.ts'
import { connectRouter } from './routes/connect.ts'
import { paymentRouter } from './routes/payment.ts'
import { stripeWebhookRouter } from './routes/stripeWebhook.ts'
import { safetyRouter } from './routes/safety.ts'
import { authRouter } from './routes/auth.ts'
import { gasPriceRouter } from './routes/gasPrice.ts'
import { addressesRouter } from './routes/addresses.ts'
import { adminRouter } from './routes/admin/index.ts'
import { opsRouter } from './routes/ops.ts'
import { vehicleRouter } from './routes/vehicle.ts'
import { reportRouter } from './routes/report.ts'
import { accountRouter } from './routes/account.ts'
import { usersRouter } from './routes/users.ts'
import { liveActivityRouter } from './routes/liveActivity.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { metricsMiddleware } from './middleware/metrics.ts'

export const app = express()

// Trust first proxy (e.g. ALB / CloudFront / nginx) so express-rate-limit
// and req.ip use the real client IP from X-Forwarded-For
app.set('trust proxy', 1)

// CORS — allow Vercel production, preview deploys, and localhost dev
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?tagorides\.com$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
]

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, server-to-server, curl)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))) {
      return callback(null, true)
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))

// Stripe webhook needs raw body for signature verification — mount BEFORE json parser and rate limiter
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter)

// ── Rate limiting ──────────────────────────────────────────────────────────
// Dev: disabled entirely so local testing with one engineer driving both
// sides of a ride doesn't trip limits. Prod: two buckets — a generous
// global bucket for ordinary routes, and a separate higher-volume bucket
// for `/gps-ping` since GPS fires every ~10 s per party per ride and would
// otherwise burn the global budget in minutes.
const IS_PROD = process.env['NODE_ENV'] === 'production'

const RATE_LIMIT_MESSAGE = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
}

// General bucket: 2000 requests / 15 min per IP. Comfortably covers a campus
// Wi-Fi full of logged-in students plus normal app polling; blocks only a
// genuinely abusive client.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !IS_PROD,
  message: RATE_LIMIT_MESSAGE,
})

// GPS-ping bucket: 600 requests / 5 min per IP. At 6 pings/min/party × 2
// parties that's 12/min; a NATted campus network with ~20 simultaneous
// pinging phones is ~240/min — still well under the 600 ceiling.
const gpsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !IS_PROD,
  message: RATE_LIMIT_MESSAGE,
})

// Mount the GPS limiter on the specific path BEFORE the general limiter so
// gps-ping traffic is counted only against its own bucket.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/rides/') && req.path.endsWith('/gps-ping')) {
    return gpsLimiter(req, res, next)
  }
  return generalLimiter(req, res, next)
})

app.use(cookieParser())
app.use(express.json())

// Request + bandwidth meter (R.23). Must come after body parsing but before
// route handlers so every /api/* response is counted.
app.use(metricsMiddleware)

app.use('/api/rides', ridesRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/schedule', scheduleRouter)
app.use('/api/transit', transitRouter)
app.use('/api/directions', directionsRouter)
app.use('/api/messages', messagesRouter)
app.use('/api/wallet', walletRouter)
app.use('/api/connect', connectRouter)
app.use('/api/payment', paymentRouter)
app.use('/api/safety', safetyRouter)
app.use('/api/auth', authRouter)
app.use('/api/gas-price', gasPriceRouter)
app.use('/api/addresses', addressesRouter)
app.use('/api/vehicle', vehicleRouter)
app.use('/api/report', reportRouter)
// Operator-only token-gated maintenance endpoints (was `/api/admin/*` pre-2026-05-17).
app.use('/api/ops', opsRouter)
// Team admin panel — JWT + users.is_admin = true. Slice 0.3 of ADMIN_PLAN.md.
app.use('/api/admin', adminRouter)
app.use('/api/account', accountRouter)
app.use('/api/users', usersRouter)
app.use('/api/live-activity', liveActivityRouter)

// ── SPA fallback — serve built frontend in production ─────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(__dirname, '../dist')

app.use(express.static(distPath))

// Catch-all for non-API routes → serve index.html for client-side routing
// API routes that don't match any handler get a proper 404 JSON response
app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} not found` } })
    return
  }
  res.sendFile(path.join(distPath, 'index.html'))
})

app.use(errorHandler)
