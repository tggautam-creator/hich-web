/**
 * Marketing Advisor chat — Phase 4.
 *
 * Persisted chat threads with an agent that has Tago's frozen
 * brand context loaded (BRAND_SYSTEM_PROMPT) + live KPI snapshot
 * injected at thread-start. Runs on Gemini 2.5 Pro by default for
 * stronger strategic reasoning; falls back to Flash if the Pro
 * call rate-limits.
 *
 * Threads + messages live in marketing_advisor_threads /
 * marketing_advisor_messages (created by migration 108). RLS
 * scopes both to the admin who owns the thread.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import {
  geminiChat,
  geminiChatWithTools,
  humanizeGeminiError,
  MODEL_SMART,
  MODEL_FAST,
  isGeminiConfigured,
  type ChatMessage,
} from './gemini.ts'
import {
  BRAND_SYSTEM_PROMPT,
  buildKpiSnippet,
  type LiveKpiSnapshot,
} from './brandContext.ts'
import {
  ADVISOR_TOOLS,
  SCHEMA_DESCRIPTION,
  dispatchToolCall,
} from './advisorTools.ts'

const ADVISOR_MODEL_DEFAULT = MODEL_SMART  // gemini-2.5-pro
const ADVISOR_MODEL_FALLBACK = MODEL_FAST  // gemini-2.5-flash

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface AdvisorThreadRow {
  id: string
  title: string
  user_id: string
  created_at: string
  updated_at: string
}

export interface AdvisorMessageRow {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

// ── KPI snapshot ───────────────────────────────────────────────────

/**
 * Fetches a small, fast slice of the same KPIs that /api/admin/stats
 * surfaces, but inline (we don't want to hit the HTTP route from
 * the server). Used to seed the advisor agent with live numbers
 * at thread-start so its recommendations are grounded.
 */
async function fetchLiveKpis(): Promise<LiveKpiSnapshot> {
  const now = new Date()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - MS_PER_DAY).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString()
  const monthAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()

  const [
    dauRes, wauRes, mauRes, onlineRes, totalUsersRes, totalDriversRes,
    onboardedRes, completedRes, revenueRes, emailsRes,
  ] = await Promise.all([
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', dayAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', weekAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', monthAgo),
    supabaseAdmin.from('driver_locations').select('user_id').gte('recorded_at', fiveMinAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('is_driver', true),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('is_driver', true).not('stripe_account_id', 'is', null),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    supabaseAdmin.from('rides').select('fare_cents').eq('status', 'completed').eq('payment_status', 'paid').gte('ended_at', todayStart),
    supabaseAdmin.from('users').select('email'),
  ])

  const onlineSet = new Set<string>()
  for (const r of onlineRes.data ?? []) {
    const uid = (r as { user_id?: string }).user_id
    if (uid) onlineSet.add(uid)
  }

  const revenueToday = (revenueRes.data ?? []).reduce(
    (acc, r) => acc + ((r as { fare_cents?: number }).fare_cents ?? 0),
    0,
  )

  const universities = new Set<string>()
  for (const u of emailsRes.data ?? []) {
    const email = ((u as { email?: string | null }).email ?? '').toLowerCase()
    const at = email.lastIndexOf('@')
    if (at < 0) continue
    const domain = email.slice(at + 1)
    if (domain.endsWith('.edu')) universities.add(domain)
  }

  return {
    dau: dauRes.count ?? 0,
    wau: wauRes.count ?? 0,
    mau: mauRes.count ?? 0,
    online_drivers: onlineSet.size,
    total_users: totalUsersRes.count ?? 0,
    total_drivers: totalDriversRes.count ?? 0,
    stripe_onboarded_drivers: onboardedRes.count ?? 0,
    total_completed: completedRes.count ?? 0,
    revenue_today_cents: revenueToday,
    universities: universities.size,
  }
}

// ── Threads ────────────────────────────────────────────────────────

export async function createThread(userId: string, title?: string): Promise<AdvisorThreadRow | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .insert({ user_id: userId, title: title?.trim() || 'New conversation' } as never)
    .select('id, title, user_id, created_at, updated_at')
    .single()
  if (error || !data) {
    console.error('[marketing/advisor] createThread failed:', error?.message)
    return null
  }
  return data as AdvisorThreadRow
}

export async function listThreads(userId: string): Promise<AdvisorThreadRow[]> {
  const { data, error } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .select('id, title, user_id, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[marketing/advisor] listThreads failed:', error.message)
    return []
  }
  return (data ?? []) as AdvisorThreadRow[]
}

export async function getThreadWithMessages(
  threadId: string,
  userId: string,
): Promise<{ thread: AdvisorThreadRow; messages: AdvisorMessageRow[] } | null> {
  const { data: tdata, error: terr } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .select('id, title, user_id, created_at, updated_at')
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()
  if (terr || !tdata) return null
  const { data: mdata } = await supabaseAdmin
    .from('marketing_advisor_messages')
    .select('id, thread_id, role, content, input_tokens, output_tokens, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  return {
    thread: tdata as AdvisorThreadRow,
    messages: (mdata ?? []) as AdvisorMessageRow[],
  }
}

export async function deleteThread(threadId: string, userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .delete()
    .eq('id', threadId)
    .eq('user_id', userId)
  if (error) {
    console.error('[marketing/advisor] deleteThread failed:', error.message)
    return false
  }
  return true
}

// ── Messages ───────────────────────────────────────────────────────

export interface SendMessageResult {
  ok: boolean
  assistant_message?: AdvisorMessageRow
  error?: string
}

/**
 * Append a user message + immediately call Gemini for the assistant
 * response + append that too. Returns the assistant message row.
 *
 * KPI injection: when this is the FIRST message of a thread, we
 * fetch live KPIs and prepend them to the system prompt so the
 * advisor grounds its first answer in real numbers. Subsequent
 * messages skip the live fetch (the KPIs are already in the
 * prior context).
 */
export async function sendMessage(args: {
  threadId: string
  userId: string
  userContent: string
}): Promise<SendMessageResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, error: 'GEMINI_API_KEY not configured' }
  }
  if (args.userContent.trim().length < 1) {
    return { ok: false, error: 'message body required' }
  }

  // Confirm thread ownership.
  const { data: thread, error: terr } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .select('id, title, user_id')
    .eq('id', args.threadId)
    .eq('user_id', args.userId)
    .maybeSingle()
  if (terr || !thread) {
    return { ok: false, error: 'thread not found or not owned by user' }
  }

  // Load existing messages newest-first (limit 200) then reverse, so
  // long threads keep the most-recent context Gemini cares about
  // rather than truncating away the recent turns. Log a warning when
  // we hit the cap so a future long-thread issue is visible in PM2.
  const HISTORY_CAP = 200
  // Count + fetch in one round-trip: PostgREST returns the exact count
  // when count='exact' is set, letting us detect truncation precisely.
  const { data: prior, count: priorCount } = await supabaseAdmin
    .from('marketing_advisor_messages')
    .select('id, role, content, created_at', { count: 'exact' })
    .eq('thread_id', args.threadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_CAP)
  const newestFirstRows = (prior ?? []) as Array<{ role: string; content: string }>
  const priorRows = newestFirstRows.slice().reverse()
  if (typeof priorCount === 'number' && priorCount > HISTORY_CAP) {
    console.warn(
      `[marketing/advisor] thread ${args.threadId} has ${priorCount} messages; sending only the most recent ${HISTORY_CAP} to Gemini.`,
    )
  }

  // isFirstMessage uses the total count, not the truncated array, so
  // KPIs aren't re-injected on long threads where priorRows is just
  // the recent slice.
  const isFirstMessage = (priorCount ?? priorRows.length) === 0

  // Build system prompt: brand context + DB schema + (KPIs only on
  // first turn). Schema lives in the system prompt so the advisor
  // knows what tables/columns to query via the tools — no extra
  // prompt-tokens per tool call.
  let systemPrompt = `${BRAND_SYSTEM_PROMPT}\n\n${SCHEMA_DESCRIPTION}`
  if (isFirstMessage) {
    try {
      const kpis = await fetchLiveKpis()
      systemPrompt = `${systemPrompt}\n\n${buildKpiSnippet(kpis)}`
    } catch (err) {
      console.warn('[marketing/advisor] KPI fetch failed; using base brand prompt only:', err)
    }
  }

  // Insert the user message BEFORE the Gemini call so it persists
  // even if Gemini errors.
  const { error: insertUserErr } = await supabaseAdmin
    .from('marketing_advisor_messages')
    .insert({
      thread_id: args.threadId,
      role: 'user',
      content: args.userContent.trim(),
    } as never)
  if (insertUserErr) {
    console.error('[marketing/advisor] insert user message failed:', insertUserErr.message)
    return { ok: false, error: insertUserErr.message }
  }

  // Call Gemini Pro; fall back to Flash on 429 / quota errors so a
  // busy day doesn't dead-end the conversation.
  const history: ChatMessage[] = priorRows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  let modelUsed = ADVISOR_MODEL_DEFAULT
  let result: { text: string; inputTokens: number | null; outputTokens: number | null }
  try {
    // Use the tool-use chat so Gemini can query the database when
    // needed. Tools defined in advisorTools.ts; dispatcher invokes
    // them with safety (whitelist tables, scrub PII, cap rows).
    const r = await geminiChatWithTools({
      systemPrompt,
      history,
      userPrompt: args.userContent,
      tools: [...ADVISOR_TOOLS],
      dispatch: dispatchToolCall,
      model: ADVISOR_MODEL_DEFAULT,
      temperature: 0.7,
    })
    if (r.tool_calls.length > 0) {
      console.log(
        `[marketing/advisor] thread ${args.threadId} used ${r.tool_calls.length} tool call(s): `
        + r.tool_calls.map((t) => t.name).join(', '),
      )
    }
    result = { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Quota / rate-limit fallback. Pro free-tier is ~50 req/day.
    // Flash fallback skips tools (Flash supports them but the
    // schema doubles the prompt cost — for fallback we prioritize
    // getting an answer over data access).
    if (/429|quota|rate/i.test(msg)) {
      console.warn('[marketing/advisor] Pro quota hit; falling back to Flash (history preserved, no tools):', msg)
      try {
        const r = await geminiChat({
          systemPrompt,
          history,
          userPrompt: args.userContent,
          model: ADVISOR_MODEL_FALLBACK,
          temperature: 0.7,
        })
        modelUsed = ADVISOR_MODEL_FALLBACK
        result = { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
      } catch (err2) {
        return {
          ok: false,
          error: `Both Gemini Pro and Flash hit the same wall: ${humanizeGeminiError(err2)}`,
        }
      }
    } else {
      return { ok: false, error: humanizeGeminiError(err) }
    }
  }

  if (!result.text || result.text.trim().length === 0) {
    return {
      ok: false,
      error: 'The advisor replied with no text. This can happen on a borderline quota state or when the model gets stuck. Try a slightly different question or wait a moment.',
    }
  }

  const { data: assistantRow, error: insertAsstErr } = await supabaseAdmin
    .from('marketing_advisor_messages')
    .insert({
      thread_id: args.threadId,
      role: 'assistant',
      content: result.text.trim(),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    } as never)
    .select('id, thread_id, role, content, input_tokens, output_tokens, created_at')
    .single()
  if (insertAsstErr || !assistantRow) {
    return { ok: false, error: insertAsstErr?.message ?? 'assistant insert failed' }
  }

  // Bump thread.updated_at so the sidebar sorts most-recent first.
  // Also auto-name a thread off the first user message if it's still
  // the default "New conversation" title.
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (isFirstMessage && (thread as { title?: string }).title === 'New conversation') {
    // Use the first 60 chars of the user message as the auto-title.
    updates['title'] = args.userContent.trim().slice(0, 60)
  }
  await supabaseAdmin
    .from('marketing_advisor_threads')
    .update(updates as never)
    .eq('id', args.threadId)
    .then(() => undefined, (err: unknown) => {
      console.warn('[marketing/advisor] thread bump failed:', err)
    })

  // Silently log which model served the reply for cost tracking.
  if (modelUsed === ADVISOR_MODEL_FALLBACK) {
    console.log('[marketing/advisor] reply served by Flash fallback (Pro rate-limited)')
  }

  return { ok: true, assistant_message: assistantRow as AdvisorMessageRow }
}
