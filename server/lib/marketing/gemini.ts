/**
 * Thin Gemini SDK wrapper used by every marketing feature.
 *
 * One file, one place to swap models or providers later. Every
 * generator (stories, posters, advisor) calls `geminiGenerate()` or
 * `geminiChat()` rather than reaching into @google/genai directly.
 *
 * Model picks (intentional):
 *  - `MODEL_FAST`  → gemini-2.5-flash. Used for cron-driven story +
 *    poster generation. Free-tier limit is 1500 req/day which is
 *    miles above our daily volume (~10).
 *  - `MODEL_SMART` → gemini-2.5-pro. Used for the advisor agent.
 *    Smaller free-tier quota (~50 req/day) but the strategic-reasoning
 *    boost is worth it for the agent. Falls back to flash if quota
 *    hits 429 (caller decides).
 *
 * Implicit context caching: Gemini caches recent system-prompt content
 * automatically when the prefix is stable. We rely on that — no
 * explicit cache_id wiring needed for v1.
 */
import { GoogleGenAI } from '@google/genai'
import { getServerEnv } from '../../env.ts'
import { recordGeminiCall } from '../apiUsage.ts'

let _client: GoogleGenAI | null = null

export const MODEL_FAST = 'gemini-2.5-flash'
export const MODEL_SMART = 'gemini-2.5-pro'
// Phase 6.x fallback tier — older/lighter models with separate
// free-tier quota buckets. Used only by the chain helpers below;
// individual generators never reference these constants directly.
export const MODEL_FAST_2 = 'gemini-2.0-flash'
export const MODEL_FAST_LITE = 'gemini-2.5-flash-lite'

export function isGeminiConfigured(): boolean {
  return getServerEnv().GEMINI_API_KEY.length > 0
}

/**
 * Phase 5 — turn raw Gemini errors into UX-friendly messages.
 * Quota 429s are the dominant failure on free tier; surface them
 * clearly so the admin knows "wait for UTC midnight" not "code bug".
 */
export function humanizeGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // 429 quota exhausted (free tier)
  if (/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw)) {
    // Try to extract the retry-after delay if present.
    const retryMatch = raw.match(/retry in (\d+(?:\.\d+)?)s/i)
    const retryHint = retryMatch
      ? ` Retry in ${Math.ceil(Number(retryMatch[1]!))}s.`
      : ' Free-tier quota resets at UTC midnight, or enable billing on the GCP project for higher limits.'
    return `Gemini API quota reached.${retryHint}`
  }
  if (/PERMISSION_DENIED|403/.test(raw)) {
    return 'Gemini API rejected the request (permission denied). Check that the API key is valid and the Generative Language API is enabled on the project.'
  }
  if (/UNAUTHENTICATED|401|invalid.+credentials/i.test(raw)) {
    return 'Gemini API key is invalid or expired. Check GEMINI_API_KEY in .env.prod.'
  }
  if (/timeout|deadline/i.test(raw)) {
    return 'Gemini API timed out. The model may be temporarily overloaded; try again in a moment.'
  }
  // Fall through to the raw message but trim it to something readable.
  return raw.length > 300 ? `${raw.slice(0, 297)}...` : raw
}

function getClient(): GoogleGenAI {
  if (_client) return _client
  const apiKey = getServerEnv().GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      '[marketing/gemini] GEMINI_API_KEY is not set. The marketing '
      + 'panel cannot generate content without it. Add the key to '
      + '.env.prod on EC2 (and .env.dev locally) and restart the '
      + 'server.',
    )
  }
  _client = new GoogleGenAI({ apiKey })
  return _client
}

export interface GenerateArgs {
  systemPrompt: string
  userPrompt: string
  model?: string
  temperature?: number
  maxOutputTokens?: number
  /**
   * When the response must be pure JSON, pass 'application/json'.
   * Gemini will skip markdown fences and emit only the JSON body —
   * eliminates the markdown-fence stripping the caller would
   * otherwise have to do.
   */
  responseMimeType?: string
  /**
   * Thinking budget for 2.5-series thinking models. Set to 0 to
   * disable reasoning entirely (faster + cheaper for short
   * deterministic tasks like template-filling copywriting).
   * Undefined leaves the model's default (which can consume most
   * of maxOutputTokens on a thinking pass and truncate the actual
   * response).
   */
  thinkingBudget?: number
  /**
   * Enable Google Search grounding so the model can pull
   * real-time web data before answering. Required for any task
   * that needs CURRENT information (concert tour dates, festival
   * lineups this year, news, etc.). Cost: $0.035 per grounded
   * query (grounding fee) PLUS the normal per-token output cost
   * (~$0.03 for a typical refresh on 2.5-pro). Total ~$0.07/refresh.
   * Incompatible with responseMimeType — caller must parse JSON
   * out of free-form text when grounding is on.
   */
  useGoogleSearch?: boolean
}

export interface GenerateResultWithGrounding extends GenerateResult {
  /** Source URLs the model consulted via Google Search (if any). */
  groundingUrls?: string[]
}

export interface GenerateResult {
  text: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
}

/**
 * One-shot generation. Returns the model's text response plus token
 * counts (when Gemini reports them) for budget tracking.
 *
 * Default model is FAST (Flash) because every cron-driven path
 * (stories, posters, daily briefing) uses it. The advisor agent
 * passes `MODEL_SMART` explicitly.
 */
export async function geminiGenerate(args: GenerateArgs): Promise<GenerateResultWithGrounding> {
  const client = getClient()
  const model = args.model ?? MODEL_FAST

  // googleSearch + responseMimeType/responseSchema are mutually
  // exclusive in the API. Throw fail-fast rather than warn —
  // silent-drop would let a future caller (e.g. storyGenerator)
  // accidentally enable grounding + lose JSON-mode + produce
  // malformed output in prod. JSDoc on the field already documents
  // the constraint; this matches it.
  if (args.useGoogleSearch && args.responseMimeType) {
    throw new TypeError(
      '[gemini] useGoogleSearch is incompatible with responseMimeType. Drop responseMimeType and parse JSON out of free-form text in the caller.',
    )
  }

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: args.userPrompt }] }],
    config: {
      systemInstruction: args.systemPrompt,
      temperature: args.temperature ?? 0.85,
      maxOutputTokens: args.maxOutputTokens ?? 1024,
      ...(args.responseMimeType && !args.useGoogleSearch
        ? { responseMimeType: args.responseMimeType }
        : {}),
      ...(args.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: args.thinkingBudget } }
        : {}),
      ...(args.useGoogleSearch
        ? { tools: [{ googleSearch: {} }] as never }
        : {}),
    },
  })
  // Quota counter increment — fire-and-forget. We record AFTER the
  // call resolves successfully so a 429 / network failure doesn't
  // inflate the counter (the spent quota tick happened on Google's
  // side but our counter would otherwise double-count vs reality on
  // retries). The .catch keeps the promise chain clean.
  void recordGeminiCall(model).catch(() => undefined)

  const text = response.text ?? ''
  const usage = response.usageMetadata

  // Extract grounding citations if Google Search ran. Pull from
  // candidates[0].groundingMetadata.groundingChunks[].web.uri per
  // the SDK shape. De-duplicated.
  let groundingUrls: string[] | undefined
  if (args.useGoogleSearch) {
    const chunks = (response.candidates?.[0] as {
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> }
    } | undefined)?.groundingMetadata?.groundingChunks ?? []
    const urls = new Set<string>()
    for (const c of chunks) {
      const u = c.web?.uri
      if (typeof u === 'string' && u.length > 0) urls.add(u)
    }
    if (urls.size > 0) groundingUrls = Array.from(urls)
  }

  return {
    text,
    model,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
    ...(groundingUrls ? { groundingUrls } : {}),
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Multi-turn chat for the advisor agent. The `history` is the prior
 * thread (user + assistant messages alternating); `userPrompt` is
 * the new message. Returns just the new assistant response — the
 * caller persists both sides to marketing_advisor_messages.
 */
export async function geminiChat(args: {
  systemPrompt: string
  history: ChatMessage[]
  userPrompt: string
  model?: string
  temperature?: number
}): Promise<GenerateResult> {
  const client = getClient()
  const model = args.model ?? MODEL_SMART

  // Map our role names to Gemini's: assistant → 'model'.
  const contents = [
    ...args.history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: args.userPrompt }] },
  ]

  const response = await client.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: args.systemPrompt,
      temperature: args.temperature ?? 0.7,
      maxOutputTokens: 2048,
    },
  })
  void recordGeminiCall(model).catch(() => undefined)

  const text = response.text ?? ''
  const usage = response.usageMetadata
  return {
    text,
    model,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
  }
}


// ── Tool-use chat (Phase 4.1) ─────────────────────────────────────

export interface ToolDeclaration {
  name: string
  description: string
  parameters: {
    type: 'object'
    required?: string[]
    properties: Record<string, unknown>
  }
}

export type ToolDispatcher = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>

interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result: unknown
}

/**
 * Multi-turn chat WITH tool use. Loops up to maxIterations times
 * (default 5), calling the dispatcher for each function_call the
 * model emits and feeding the result back in. Returns the final
 * text + a transcript of every tool call (for debugging + cost
 * tracking).
 */
export async function geminiChatWithTools(args: {
  systemPrompt: string
  history: ChatMessage[]
  userPrompt: string
  tools: ToolDeclaration[]
  dispatch: ToolDispatcher
  model?: string
  temperature?: number
  maxIterations?: number
}): Promise<GenerateResult & { tool_calls: ToolCallRecord[] }> {
  const client = getClient()
  const model = args.model ?? MODEL_SMART
  const maxIter = args.maxIterations ?? 5

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    ...args.history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content } as Record<string, unknown>],
    })),
    { role: 'user', parts: [{ text: args.userPrompt } as Record<string, unknown>] },
  ]

  const toolCalls: ToolCallRecord[] = []
  let totalInput = 0
  let totalOutput = 0
  let finalText = ''

  // Accumulate any "narration" text the model emits alongside tool
  // calls (Gemini sometimes says "Let me look that up..." in a text
  // part next to a functionCall part). Useful for the close-out path
  // and as a fallback if the model never produces a tool-free turn.
  let narration = ''

  for (let iter = 0; iter < maxIter; iter++) {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: args.systemPrompt,
        temperature: args.temperature ?? 0.7,
        maxOutputTokens: 2048,
        tools: [{ functionDeclarations: args.tools }] as never,
        // Disable automatic function calling — we run the dispatcher
        // manually so the SDK's auto-loop (default-on for
        // CallableTool, no-op for declaration-only tools today) would
        // double-invoke if Google ever broadens it.
        automaticFunctionCalling: { disable: true } as never,
      },
    })
    // Each tool-loop iteration is a separately-billed call. Record
    // it as the same model — every iteration is one API hit.
    void recordGeminiCall(model).catch(() => undefined)

    const usage = response.usageMetadata
    totalInput += usage?.promptTokenCount ?? 0
    totalOutput += usage?.candidatesTokenCount ?? 0

    const parts = response.candidates?.[0]?.content?.parts ?? []
    const functionCalls = parts
      .map((p) => (p as { functionCall?: { name?: string; args?: Record<string, unknown> } }).functionCall)
      .filter((fc): fc is { name: string; args: Record<string, unknown> } => Boolean(fc?.name))

    // Capture any text parts in this turn — they survive even when
    // the same turn also has functionCall parts.
    const turnText = parts
      .map((p) => (p as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim()
    if (turnText) narration += (narration ? '\n\n' : '') + turnText

    console.log(`[gemini/tools] iter ${iter + 1}/${maxIter} → ${functionCalls.length} fn call(s)${turnText ? `, ${turnText.length} chars narration` : ''}`)

    if (functionCalls.length === 0) {
      finalText = (response.text ?? '').trim() || narration
      break
    }

    contents.push({
      role: 'model',
      parts: functionCalls.map((fc) =>
        ({ functionCall: { name: fc.name, args: fc.args ?? {} } } as Record<string, unknown>),
      ),
    })

    const responseParts: Array<Record<string, unknown>> = []
    for (const fc of functionCalls) {
      let result: unknown
      try {
        result = await args.dispatch(fc.name, fc.args ?? {})
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      toolCalls.push({ name: fc.name, args: fc.args ?? {}, result })
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: { content: result },
        },
      })
    }
    // Gemini's SDK accepts ONLY 'user' or 'model' as Content.role.
    // The tool-result turn is the client acting as the user with a
    // functionResponse part — not a separate 'function' role. Using
    // 'function' silently drops the turn → next iteration has no
    // grounding → loop exhausts → empty response.
    contents.push({ role: 'user', parts: responseParts })
  }

  // Loop exhausted maxIter without a tool-free turn. Force a final
  // close-out call WITHOUT tools so the model has to write text.
  // Guarantees the user always sees an answer.
  if (!finalText) {
    console.warn(`[gemini/tools] maxIterations(${maxIter}) hit without final text; forcing tool-less close-out call`)
    try {
      const closeout = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: args.systemPrompt,
          temperature: args.temperature ?? 0.7,
          maxOutputTokens: 2048,
        },
      })
      void recordGeminiCall(model).catch(() => undefined)
      const usage = closeout.usageMetadata
      totalInput += usage?.promptTokenCount ?? 0
      totalOutput += usage?.candidatesTokenCount ?? 0
      finalText = (closeout.text ?? '').trim() || narration
    } catch (err) {
      console.error('[gemini/tools] close-out call failed:', err)
      finalText = narration || ''
    }
  }

  return {
    text: finalText,
    model,
    inputTokens: totalInput || null,
    outputTokens: totalOutput || null,
    tool_calls: toolCalls,
  }
}

// ── Fallback chains (Phase 6.x — 2026-05-31) ──────────────────────
//
// A "chain" is an ordered list of model IDs to try in sequence on
// 429 / RESOURCE_EXHAUSTED. The runner skips down the list on quota
// errors only; any other error (parse, 500, network) propagates
// immediately so we never burn retries on a real bug.
//
// Chains live alongside MODEL_FAST/MODEL_SMART so generators import
// one constant instead of hard-coding the list at the call site.

export type ModelChain = readonly string[]

/** Used for stories + posters — Flash-tier with 2.0 + Lite fallback. */
export const TEXT_FAST_CHAIN: ModelChain = [MODEL_FAST, MODEL_FAST_2, MODEL_FAST_LITE] as const
/** Used for advisor (with tools) — Pro-first, Flash with tools as fallback. */
export const TOOLS_CHAIN: ModelChain = [MODEL_SMART, MODEL_FAST] as const
/** Used for calendar refresh-AI — Pro grounded, Flash grounded as fallback.
 *  2.0 / Lite are intentionally excluded — googleSearch tool is stable
 *  on the 2.5 series; falling back to 2.5 Flash preserves grounding
 *  rather than silently dropping it. */
export const GROUNDED_CHAIN: ModelChain = [MODEL_SMART, MODEL_FAST] as const

export interface FallbackAttempt {
  model: string
  /** Undefined when this attempt succeeded (always the last entry). */
  error?: string
  /** True when error matched the quota class + we tried the next model. */
  quotaSkip?: boolean
}

export interface GenerateWithFallbackResult extends GenerateResultWithGrounding {
  /** Model that actually produced the returned text. */
  modelUsed: string
  /** Ordered attempt log — the LAST entry is always the successful (or
   *  final-failure) attempt. Useful for telemetry + the UI banner. */
  attempts: FallbackAttempt[]
}

/**
 * Detects the quota-class errors we treat as "try the next model in
 * the chain". Anything else propagates immediately. Matches the SDK
 * error strings + the formal RESOURCE_EXHAUSTED status enum.
 */
export function isQuotaError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err)
  return /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw)
}

/**
 * Walks `chain` in order, calling geminiGenerate with each model
 * until one succeeds or the chain is exhausted. Quota errors skip
 * to the next; non-quota errors throw immediately. Returns the
 * successful generation along with which model produced it.
 *
 * `args.model` is IGNORED — chains are the only way to pick a model
 * here. Callers wanting a single-shot keep using geminiGenerate.
 */
export async function geminiGenerateWithFallback(
  args: Omit<GenerateArgs, 'model'>,
  chain: ModelChain,
): Promise<GenerateWithFallbackResult> {
  if (chain.length === 0) throw new Error('[gemini] empty fallback chain')
  const attempts: FallbackAttempt[] = []
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!
    try {
      const r = await geminiGenerate({ ...args, model })
      attempts.push({ model })
      return { ...r, modelUsed: model, attempts }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isQuotaError(err)) {
        attempts.push({ model, error: msg })
        throw err
      }
      attempts.push({ model, error: msg, quotaSkip: true })
      console.warn(`[gemini/fallback] ${model} quota-skipped (${i + 1}/${chain.length}): ${humanizeGeminiError(err)}`)
    }
  }
  const last = attempts[attempts.length - 1]!
  throw new Error(`All ${chain.length} models in chain hit quota. Last error from ${last.model}: ${last.error}`)
}

/**
 * Tool-chat equivalent for the advisor. Same skip-on-quota semantics.
 * Crucially, the fallback model KEEPS tools (Flash supports function
 * calling) — earlier Phase-4 fallback dropped tools in exchange for
 * survival; now we get both.
 */
export async function geminiChatWithToolsAndFallback(
  args: Omit<Parameters<typeof geminiChatWithTools>[0], 'model'>,
  chain: ModelChain,
): Promise<Awaited<ReturnType<typeof geminiChatWithTools>> & {
  modelUsed: string
  attempts: FallbackAttempt[]
}> {
  if (chain.length === 0) throw new Error('[gemini] empty fallback chain')
  const attempts: FallbackAttempt[] = []
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!
    try {
      const r = await geminiChatWithTools({ ...args, model })
      attempts.push({ model })
      return { ...r, modelUsed: model, attempts }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isQuotaError(err)) {
        attempts.push({ model, error: msg })
        throw err
      }
      attempts.push({ model, error: msg, quotaSkip: true })
      console.warn(`[gemini/fallback/tools] ${model} quota-skipped (${i + 1}/${chain.length})`)
    }
  }
  const last = attempts[attempts.length - 1]!
  throw new Error(`All ${chain.length} models in tools-chain hit quota. Last error from ${last.model}: ${last.error}`)
}
