import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
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
import { errorHandler } from './middleware/errorHandler.ts'

export const app = express()

// CORS — allow Vercel production, preview deploys, and localhost dev
const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
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

// Rate limiting — 100 requests per 15s per IP
const limiter = rateLimit({
  windowMs: 15 * 1000,
  max: 100,
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

app.use(errorHandler)
