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
import { vehicleRouter } from './routes/vehicle.ts'
import { reportRouter } from './routes/report.ts'
import { errorHandler } from './middleware/errorHandler.ts'

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

// Rate limiting — 200 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
})
app.use('/api/', limiter)

app.use(cookieParser())
app.use(express.json())

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
