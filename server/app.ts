import express from 'express'
import cors from 'cors'
import { ridesRouter } from './routes/rides.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { scheduleRouter } from './routes/schedule.ts'
import { transitRouter } from './routes/transit.ts'
import { directionsRouter } from './routes/directions.ts'
import { messagesRouter } from './routes/messages.ts'
import { walletRouter } from './routes/wallet.ts'
import { stripeWebhookRouter } from './routes/stripeWebhook.ts'
import { safetyRouter } from './routes/safety.ts'
import { errorHandler } from './middleware/errorHandler.ts'

export const app = express()

app.use(cors())

// Stripe webhook needs raw body for signature verification — mount BEFORE json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter)

app.use(express.json())

app.use('/api/rides', ridesRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/schedule', scheduleRouter)
app.use('/api/transit', transitRouter)
app.use('/api/directions', directionsRouter)
app.use('/api/messages', messagesRouter)
app.use('/api/wallet', walletRouter)
app.use('/api/safety', safetyRouter)

app.use(errorHandler)
