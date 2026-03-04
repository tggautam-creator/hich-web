import express from 'express'
import cors from 'cors'
import { ridesRouter } from './routes/rides.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { errorHandler } from './middleware/errorHandler.ts'

export const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/rides', ridesRouter)
app.use('/api/notifications', notificationsRouter)

app.use(errorHandler)
