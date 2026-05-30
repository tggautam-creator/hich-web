/**
 * Theme-angle rotation + variety helpers for Phase 3 posters.
 * Deterministic per (date, audience, format) so the same combo gives
 * the same angle; different combos walk through the list at
 * different paces. Combined with the "avoid these recent headlines"
 * injection in the prompt, this is the hybrid variety strategy.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'

export interface PosterAngle {
  key: string
  title: string
  prompt_seed: string
}

export const POSTER_ANGLES: ReadonlyArray<PosterAngle> = [
  {
    key: 'gas-reimbursement',
    title: 'Gas reimbursement (driver)',
    prompt_seed:
      'Lead with "your gas, reimbursed" as the founder-voice hook. The '
      + 'trip exists either way; sharing it pays your gas. Skip earning '
      + 'language entirely.',
  },
  {
    key: 'trust-edu',
    title: 'Trust via .edu',
    prompt_seed:
      'Lead with the .edu trust gate as the differentiator. "You only '
      + 'ride with verified UC students." Reassuring, parent-friendly, '
      + 'not preachy.',
  },
  {
    key: 'break-week',
    title: 'Break-week exodus',
    prompt_seed:
      'Lead with the calendar moment: a specific break (winter, spring, '
      + 'summer, Thanksgiving, finals) and the wave of students going '
      + 'home. Imply scarcity + timing.',
  },
  {
    key: 'split-cost',
    title: 'Split-cost framing (rider)',
    prompt_seed:
      'Lead with "split the gas, skip the bus" — concrete savings '
      + 'framing for riders. Compare implicitly to Greyhound or solo '
      + 'driving without naming competitors.',
  },
  {
    key: 'driver-keeps-100',
    title: 'Drivers keep 100% (right now)',
    prompt_seed:
      'Lead with "right now, drivers keep 100% of the fare" as the '
      + 'time-bounded edge. Phrase as gas + cost coverage, not earning. '
      + 'Use the words "right now" — do not promise it forever.',
  },
  {
    key: 'verified-only',
    title: 'Verified-students-only',
    prompt_seed:
      'Lead with student-only network as social proof: only students, '
      + 'verified .edu, no anonymous strangers. Frame against the '
      + 'discomfort of generic rideshare with random passengers.',
  },
  {
    key: 'smart-matching',
    title: 'Smart matching corridor',
    prompt_seed:
      'Lead with the Davis-anchored corridor map (Davis ⇌ SoCal / Bay '
      + 'Area / Sacramento). Specific places convert; mention one or '
      + 'two real city names from the corridors list.',
  },
  {
    key: 'frictionless',
    title: 'Frictionless 30-second post',
    prompt_seed:
      'Lead with how easy it is: 30-second post, QR-scan to start, no '
      + 'driver license uploads, no app downloads from the rider side. '
      + 'Concrete steps; no hype.',
  },
  {
    key: 'campus-life',
    title: 'Campus moment',
    prompt_seed:
      'Lead with a UC Davis-specific cultural moment: Picnic Day, '
      + 'Aggie Stadium game day, finals week, move-in. Real campus '
      + 'context, not generic college imagery.',
  },
  {
    key: 'qr-scan',
    title: 'QR-scan ride start',
    prompt_seed:
      'Lead with the QR-scan ride mechanic: 30-second post, scan to '
      + 'start, scan to end, instant payment. Concrete UX over feature '
      + 'list.',
  },
]

export function pickAngle(args: {
  forDate: string
  audience: 'rider' | 'driver' | 'both'
  format: 'ig_story' | 'ig_post' | 'a4_sheet' | 'custom'
}): PosterAngle {
  const dayHash = hashDate(args.forDate)
  const audHash = args.audience === 'rider' ? 0 : args.audience === 'driver' ? 3 : 7
  const fmtHash = args.format === 'ig_story' ? 0
    : args.format === 'ig_post' ? 2
    : args.format === 'a4_sheet' ? 5
    : 11
  const idx = (dayHash + audHash + fmtHash) % POSTER_ANGLES.length
  return POSTER_ANGLES[idx]!
}

function hashDate(dateStr: string): number {
  let h = 0
  for (let i = 0; i < dateStr.length; i++) {
    h = (h + dateStr.charCodeAt(i)) >>> 0
  }
  return h
}

export async function fetchRecentPosterHeadlines(limit = 5): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('marketing_poster_items')
    .select('headline')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[marketing/posters] recent headlines fetch failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ headline: string | null }>)
    .map((r) => (r.headline ?? '').trim())
    .filter((h) => h.length > 0)
}

export interface FormatSpec {
  key: string
  human_label: string
  aspect_ratio: string
  pixel_dims: string
  composition_rules: string
}

export const FORMAT_SPECS: Record<string, FormatSpec> = {
  ig_story: {
    key: 'ig_story',
    human_label: 'Instagram Story',
    aspect_ratio: '9:16',
    pixel_dims: '1080x1920',
    composition_rules:
      'Vertical canvas. Headline lives in the top third (clear of '
      + 'Instagram\'s top bar). CTA in the bottom third (clear of the '
      + 'swipe-up area). Middle third reserved for the hero visual. '
      + 'Leave whitespace for the link sticker.',
  },
  ig_post: {
    key: 'ig_post',
    human_label: 'Instagram Feed Post',
    aspect_ratio: '1:1',
    pixel_dims: '1080x1080',
    composition_rules:
      'Square canvas. Centered hero element. Headline + CTA balanced '
      + 'vertically. Must read at thumbnail size in the feed grid.',
  },
  a4_sheet: {
    key: 'a4_sheet',
    human_label: 'A4 Sheet (printable)',
    aspect_ratio: '8.5:11',
    pixel_dims: '2550x3300 (300 DPI)',
    composition_rules:
      'Portrait page for physical printing — campus bulletin boards, '
      + 'dorm flyers. More body copy ok. QR code in the lower right '
      + 'pointing at tagorides.com. High contrast for poor lighting; '
      + 'sans-serif for arm\'s-length legibility.',
  },
  custom: {
    key: 'custom',
    human_label: 'Custom format',
    aspect_ratio: 'specified by founder',
    pixel_dims: 'specified by founder',
    composition_rules:
      'Use the dimensions + composition rules the founder specifies in '
      + 'their note. If unspecified, default to 9:16 Instagram Story.',
  },
}
