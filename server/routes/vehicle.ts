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
    // 2026-05-05 — auto.dev migrated their plate-lookup endpoint from
    // `api.auto.dev/plate/...` to `auto.dev/api/plate/...`. The old
    // subdomain now returns Cloudflare 503 (error code 1102 — origin
    // unreachable). The new path also returns a NESTED response shape
    // (`vehicleYearMakeModels[].makes[].models[].trims[]`) instead of
    // the legacy flat shape.
    const url = `https://auto.dev/api/plate/${stateCode}/${cleanPlate}`

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

    interface AutoDevOption {
      isDefault?: boolean
      displayName?: string
    }
    interface AutoDevTrim {
      displayName?: string
      bodyStyle?: string
      drivetrains?: AutoDevOption[]
      engines?: AutoDevOption[]
      transmissions?: AutoDevOption[]
    }
    interface AutoDevModel {
      displayName?: string
      trims?: AutoDevTrim[]
    }
    interface AutoDevMake {
      displayName?: string
      models?: AutoDevModel[]
    }
    interface AutoDevYear {
      displayName?: string
      makes?: AutoDevMake[]
    }
    interface AutoDevResponse {
      vin?: string
      vehicleYearMakeModels?: AutoDevYear[]
    }

    const data = (await response.json()) as AutoDevResponse

    // Walk the nested tree, taking the first item at every level. The
    // API typically returns one year/make/model for a given plate; if
    // it ever returns multiple (e.g. ambiguous plate), we surface the
    // first match — same UX as the legacy flat response.
    const year = data.vehicleYearMakeModels?.[0]
    const make = year?.makes?.[0]
    const model = make?.models?.[0]
    const trim = model?.trims?.[0]

    // Pick the `isDefault: true` option when present; fall back to the
    // first option otherwise. Matches what auto.dev's web UI surfaces.
    const pickDefault = (opts?: AutoDevOption[]): string | null => {
      if (!opts || opts.length === 0) return null
      return (opts.find((o) => o.isDefault === true)?.displayName ?? opts[0]?.displayName) ?? null
    }

    const yearNum = year?.displayName ? Number(year.displayName) : null

    res.json({
      vin: data.vin ?? null,
      year: yearNum != null && !Number.isNaN(yearNum) ? yearNum : null,
      make: make?.displayName ?? null,
      model: model?.displayName ?? null,
      trim: trim?.displayName ?? null,
      body: trim?.bodyStyle ?? null,
      engine: pickDefault(trim?.engines),
      drivetrain: pickDefault(trim?.drivetrains),
      transmission: pickDefault(trim?.transmissions),
    })
  } catch (err) {
    console.error('[vehicle/plate-lookup] unexpected error:', err)
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Vehicle lookup failed — please try again' },
    })
  }
})
