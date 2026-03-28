/**
 * Vehicle routes — license plate lookup via auto.dev API.
 *
 * POST /api/vehicle/plate-lookup
 *   Body: { plate: string, state: string }
 *   Returns: { vin, year, make, model, trim, body, engine, drivetrain, transmission }
 *
 * The API key is kept server-side so it's never exposed to the browser.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { validateJwt } from '../middleware/auth.ts'

export const vehicleRouter = Router()

vehicleRouter.post('/plate-lookup', validateJwt, async (req: Request, res: Response) => {
  const { plate, state } = req.body as { plate?: string; state?: string }

  if (!plate || !state) {
    res.status(400).json({
      error: { code: 'MISSING_FIELDS', message: 'plate and state are required' },
    })
    return
  }

  if (!/^[A-Z]{2}$/i.test(state.trim())) {
    res.status(400).json({
      error: { code: 'INVALID_STATE', message: 'state must be a 2-letter US state code' },
    })
    return
  }

  const cleanPlate = plate.trim().replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z0-9]{2,8}$/.test(cleanPlate)) {
    res.status(400).json({
      error: { code: 'INVALID_PLATE', message: 'License plate must be 2-8 alphanumeric characters' },
    })
    return
  }

  const apiKey = process.env['AUTO_DEV_API_KEY']
  if (!apiKey) {
    console.error('[vehicle/plate-lookup] AUTO_DEV_API_KEY not configured')
    res.status(500).json({
      error: { code: 'SERVER_CONFIG', message: 'Vehicle lookup service not configured' },
    })
    return
  }

  try {
    const stateCode = state.trim().toUpperCase()
    const url = `https://api.auto.dev/plate/${stateCode}/${cleanPlate}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({
          error: { code: 'PLATE_NOT_FOUND', message: 'No vehicle found for this plate and state' },
        })
        return
      }
      const text = await response.text()
      console.error(`[vehicle/plate-lookup] auto.dev error ${response.status}:`, text)
      res.status(502).json({
        error: { code: 'LOOKUP_FAILED', message: 'Vehicle lookup failed — please try again or enter details manually' },
      })
      return
    }

    const data = (await response.json()) as {
      vin?: string
      year?: number
      make?: string
      model?: string
      trim?: string
      drivetrain?: string
      engine?: string
      transmission?: string
      body?: string
    }

    res.json({
      vin: data.vin ?? null,
      year: data.year ?? null,
      make: data.make ?? null,
      model: data.model ?? null,
      trim: data.trim ?? null,
      body: data.body ?? null,
      engine: data.engine ?? null,
      drivetrain: data.drivetrain ?? null,
      transmission: data.transmission ?? null,
    })
  } catch (err) {
    console.error('[vehicle/plate-lookup] unexpected error:', err)
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Vehicle lookup failed — please try again' },
    })
  }
})
