/**
 * Phase 3 image generation via gemini-2.5-flash-image
 * (a.k.a. "Nano Banana"). Reads the stored image_prompt of a
 * poster item, calls the image model with responseModalities
 * forced to ['Image'] (without this the model often returns a
 * text-only description), uploads the resulting PNG/JPEG/WebP to
 * the marketing-posters Supabase Storage bucket, and stamps the
 * item with the public URL + timestamps.
 *
 * Cost: ~$0.039 per 1024x1024 image on the paid Gemini tier;
 * 100 images/day on free tier.
 */
import { GoogleGenAI } from '@google/genai'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { getServerEnv } from '../../env.ts'
import { humanizeGeminiError } from './gemini.ts'
import { recordGeminiCall } from '../apiUsage.ts'

const IMAGE_MODEL = 'gemini-2.5-flash-image'
const BUCKET = 'marketing-posters'

let _client: GoogleGenAI | null = null

/**
 * Real Tago logo PNG, base64-encoded, loaded once + cached. We pass
 * this to gemini-2.5-flash-image as a reference inlineData part so
 * the model composites OUR actual brand mark onto every generated
 * poster instead of drawing a synthetic "T". Without this, Nano
 * Banana tends to invent its own letterform that looks nothing like
 * tagorides.com.
 *
 * Source: `public/logo-transparent.png` (512x512 RGBA, ~84 KB).
 * Lookup is best-effort: if the file is missing in some runtime
 * (e.g. a build that pruned `public/`), we log + fall back to a
 * text-only call so generation still works rather than 500ing.
 */
let _logoCache: { data: string; mimeType: 'image/png' } | null = null

function loadLogoPart(): { data: string; mimeType: 'image/png' } | null {
  if (_logoCache) return _logoCache
  try {
    const path = resolve(process.cwd(), 'public', 'logo-transparent.png')
    const buf = readFileSync(path)
    _logoCache = { data: buf.toString('base64'), mimeType: 'image/png' }
    return _logoCache
  } catch (err) {
    console.warn(
      '[marketing/poster-image] logo PNG missing — falling back to text-only call:',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

function getClient(): GoogleGenAI {
  if (_client) return _client
  const apiKey = getServerEnv().GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('[marketing/poster-image] GEMINI_API_KEY not configured.')
  }
  _client = new GoogleGenAI({ apiKey })
  return _client
}

export interface ImageGenResult {
  ok: boolean
  image_url?: string
  error?: string
}

/**
 * Internal: actually call Gemini + upload + stamp the row. Errors
 * return as { ok: false, error } — never throw. Wrapper
 * generatePosterImageSafe clears stale image_url on retry-failure.
 */
async function _generate(itemId: string): Promise<ImageGenResult> {
  const { data: item, error: fetchErr } = await supabaseAdmin
    .from('marketing_poster_items')
    .select('id, image_prompt, format')
    .eq('id', itemId)
    .maybeSingle()
  if (fetchErr || !item) {
    return { ok: false, error: fetchErr?.message ?? 'item not found' }
  }
  const row = item as { id: string; image_prompt: string | null; format: string | null }
  if (!row.image_prompt || row.image_prompt.trim().length < 50) {
    return { ok: false, error: 'item has no usable image_prompt' }
  }

  // Call gemini-2.5-flash-image. responseModalities is REQUIRED for
  // reliable inline image output — without it the model often
  // returns text-only candidates describing what it would have
  // drawn (especially for text-heavy prompts like ours).
  let imageBytes: Buffer
  let foundMime: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'
  try {
    const client = getClient()
    // Always lead with the real Tago logo so Nano Banana composites
    // OUR mark, not a hallucinated "T". Fall back to text-only when
    // the PNG can't be loaded (logged in loadLogoPart()).
    const logo = loadLogoPart()
    const requestParts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> =
      logo
        ? [
            { inlineData: { data: logo.data, mimeType: logo.mimeType } },
            { text: row.image_prompt },
          ]
        : [{ text: row.image_prompt }]
    const response = await client.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts: requestParts }],
      config: {
        responseModalities: ['Image'] as never,
      },
    })
    void recordGeminiCall(IMAGE_MODEL).catch(() => undefined)

    const parts = response.candidates?.[0]?.content?.parts ?? []
    let foundBase64: string | null = null
    let rawMime: string | null = null
    for (const part of parts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData
      if (inline?.data && inline.mimeType?.startsWith('image/')) {
        foundBase64 = inline.data
        rawMime = inline.mimeType
        break
      }
    }
    if (!foundBase64) {
      const textParts = parts
        .map((p) => (p as { text?: string }).text ?? '')
        .filter(Boolean)
        .join(' ')
        .slice(0, 200)
      return { ok: false, error: `model returned no image part. text="${textParts || '(none)'}"` }
    }
    if (rawMime === 'image/png' || rawMime === 'image/jpeg' || rawMime === 'image/webp') {
      foundMime = rawMime
    } else {
      return { ok: false, error: `unsupported image mime type from model: ${rawMime}` }
    }
    imageBytes = Buffer.from(foundBase64, 'base64')
  } catch (err) {
    return { ok: false, error: humanizeGeminiError(err) }
  }

  // Upload with mime-derived extension + contentType so a JPEG/WebP
  // response is served with the correct headers (not a lying .png).
  const extension = foundMime === 'image/jpeg' ? 'jpg'
    : foundMime === 'image/webp' ? 'webp'
    : 'png'
  const path = `${row.format ?? 'ig_story'}/${row.id}.${extension}`
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, imageBytes, {
      contentType: foundMime,
      upsert: true,
    })
  if (uploadErr) {
    return { ok: false, error: `storage upload failed: ${uploadErr.message}` }
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = urlData.publicUrl
  const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`

  const { error: updateErr } = await supabaseAdmin
    .from('marketing_poster_items')
    .update({
      image_url: cacheBustedUrl,
      image_generated_at: new Date().toISOString(),
      image_model: IMAGE_MODEL,
    } as never)
    .eq('id', itemId)
  if (updateErr) {
    return {
      ok: false,
      error: `item update after upload failed: ${updateErr.message} (image at ${publicUrl})`,
    }
  }

  return { ok: true, image_url: cacheBustedUrl }
}

/**
 * Public entry point. On a regeneration failure (item already had
 * an image_url), clears the stale URL so the admin UI shows the
 * empty-state branch with the new error instead of an old image
 * implying success.
 */
export async function generatePosterImage(itemId: string): Promise<ImageGenResult> {
  const { data: existing } = await supabaseAdmin
    .from('marketing_poster_items')
    .select('image_url')
    .eq('id', itemId)
    .maybeSingle()
  const hadImage = Boolean((existing as { image_url?: string | null } | null)?.image_url)

  const result = await _generate(itemId)
  if (!result.ok && hadImage) {
    await supabaseAdmin
      .from('marketing_poster_items')
      .update({ image_url: null, image_generated_at: null } as never)
      .eq('id', itemId)
      .then(() => undefined, () => undefined)
  }
  return result
}
