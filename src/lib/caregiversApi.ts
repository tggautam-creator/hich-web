/**
 * v1.2 Sprint 6 — caregivers Supabase-SDK client.
 *
 * Mirrors iOS `CaregiversRepository.swift` 1:1 — both clients talk
 * directly to the `caregivers` table via the user's RLS-scoped
 * Supabase session, not the `/api/caregivers/*` REST routes. The
 * REST routes are still wired (server/routes/caregivers.ts) but are
 * unused on both web and iOS today. Keeping both clients on the same
 * write path means there's one set of validation semantics (RLS +
 * the column CHECK constraints in mig 089/093) instead of two.
 *
 * Hard-delete model (Tarun direction 2026-05-20): when a caregiver
 * is removed, the row is destroyed and ride/schedule references
 * NULL out via `ON DELETE SET NULL` (mig 091). No soft-delete.
 */
import { supabase } from '@/lib/supabase'
import type { Caregiver, Database } from '@/types/database'

// ── Read ─────────────────────────────────────────────────────────────

/** Load the signed-in user's caregivers, newest first. RLS scopes to `user_id = auth.uid()`. */
export async function loadCaregivers(userId: string): Promise<Caregiver[]> {
  const { data, error } = await supabase
    .from('caregivers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Caregiver[]
}

// ── Write ────────────────────────────────────────────────────────────

export interface CaregiverInsertInput {
  userId: string
  name: string
  relationship?: string | null
  phone?: string | null
  notes?: string | null
  avatarUrl?: string | null
}

/** Insert a new caregiver row + return the persisted Row. Mirrors iOS `CaregiversRepository.add`. */
export async function addCaregiver(input: CaregiverInsertInput): Promise<Caregiver> {
  const payload: Database['public']['Tables']['caregivers']['Insert'] = {
    user_id:      input.userId,
    name:         input.name,
    relationship: input.relationship ?? null,
    phone:        input.phone ?? null,
    notes:        input.notes ?? null,
    avatar_url:   input.avatarUrl ?? null,
  }
  const { data, error } = await supabase
    .from('caregivers')
    .insert(payload)
    .select()
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'caregiver insert returned no row — RLS may have blocked the write')
  }
  return data as Caregiver
}

export interface CaregiverUpdateInput {
  caregiverId: string
  name?: string
  relationship?: string | null
  phone?: string | null
  notes?: string | null
  avatarUrl?: string | null
}

/**
 * Patch any subset of mutable fields. Nullable fields accept `null`
 * to clear the column; omitting a key leaves it alone. Always bumps
 * `updated_at` so list ordering reflects recency of change.
 */
export async function updateCaregiver(input: CaregiverUpdateInput): Promise<void> {
  const payload: Database['public']['Tables']['caregivers']['Update'] = {
    updated_at: new Date().toISOString(),
  }
  if ('name' in input)         payload.name         = input.name
  if ('relationship' in input) payload.relationship = input.relationship ?? null
  if ('phone' in input)        payload.phone        = input.phone ?? null
  if ('notes' in input)        payload.notes        = input.notes ?? null
  if ('avatarUrl' in input)    payload.avatar_url   = input.avatarUrl ?? null

  const { error } = await supabase
    .from('caregivers')
    .update(payload)
    .eq('id', input.caregiverId)

  if (error) throw new Error(error.message)
}

/**
 * Hard-delete the caregiver. Past rides + ride_schedules that
 * referenced it get NULL via `ON DELETE SET NULL` (mig 091).
 */
export async function deleteCaregiver(caregiverId: string): Promise<void> {
  const { error } = await supabase
    .from('caregivers')
    .delete()
    .eq('id', caregiverId)

  if (error) throw new Error(error.message)
}
