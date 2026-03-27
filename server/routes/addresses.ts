import { Router } from 'express'
import { validateJwt } from '../middleware/auth.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const addressesRouter = Router()

const MAX_SAVED_ADDRESSES = 10

/**
 * GET /api/addresses
 * List user's saved addresses, ordered: presets first (home, work), then custom by created_at.
 */
addressesRouter.get('/', validateJwt, async (_req, res) => {
  const userId = res.locals['userId'] as string

  const { data, error } = await supabaseAdmin
    .from('saved_addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_preset', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } })
    return
  }

  res.json({ addresses: data })
})

/**
 * POST /api/addresses
 * Create or upsert a saved address.
 * For preset labels ('home', 'work'): upsert (update if exists).
 * For custom labels: insert (up to MAX_SAVED_ADDRESSES total).
 */
addressesRouter.post('/', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const { label, place_id, main_text, secondary_text, full_address, lat, lng } = req.body as {
    label?: string
    place_id?: string
    main_text?: string
    secondary_text?: string
    full_address?: string
    lat?: number
    lng?: number
  }

  if (!label || !main_text || !full_address || lat == null || lng == null) {
    res.status(400).json({
      error: { code: 'MISSING_FIELDS', message: 'label, main_text, full_address, lat, lng are required' },
    })
    return
  }

  const normalizedLabel = label.trim().toLowerCase()
  const isPreset = normalizedLabel === 'home' || normalizedLabel === 'work'

  // For presets, upsert by label
  if (isPreset) {
    const { data: existing } = await supabaseAdmin
      .from('saved_addresses')
      .select('id')
      .eq('user_id', userId)
      .eq('label', normalizedLabel)
      .maybeSingle()

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('saved_addresses')
        .update({ place_id, main_text, secondary_text, full_address, lat, lng })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } })
        return
      }
      res.json({ address: data })
      return
    }
  }

  // Check total count
  const { count } = await supabaseAdmin
    .from('saved_addresses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((count ?? 0) >= MAX_SAVED_ADDRESSES) {
    res.status(400).json({
      error: { code: 'LIMIT_REACHED', message: `Maximum ${MAX_SAVED_ADDRESSES} saved addresses allowed` },
    })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('saved_addresses')
    .insert({
      user_id: userId,
      label: isPreset ? normalizedLabel : label.trim(),
      place_id: place_id ?? null,
      main_text,
      secondary_text: secondary_text ?? null,
      full_address,
      lat,
      lng,
      is_preset: isPreset,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } })
    return
  }

  res.status(201).json({ address: data })
})

/**
 * DELETE /api/addresses/:id
 * Delete a saved address (only own addresses).
 */
addressesRouter.delete('/:id', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const id = req.params['id'] as string

  const { error } = await supabaseAdmin
    .from('saved_addresses')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } })
    return
  }

  res.json({ success: true })
})
