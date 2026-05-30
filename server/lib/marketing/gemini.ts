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

let _client: GoogleGenAI | null = null

export const MODEL_FAST = 'gemini-2.5-flash'
export const MODEL_SMART = 'gemini-2.5-pro'

export function isGeminiConfigured(): boolean {
  return getServerEnv().GEMINI_API_KEY.length > 0
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
export async function geminiGenerate(args: GenerateArgs): Promise<GenerateResult> {
  const client = getClient()
  const model = args.model ?? MODEL_FAST

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: args.userPrompt }] }],
    config: {
      systemInstruction: args.systemPrompt,
      temperature: args.temperature ?? 0.85,
      maxOutputTokens: args.maxOutputTokens ?? 1024,
      ...(args.responseMimeType ? { responseMimeType: args.responseMimeType } : {}),
      ...(args.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: args.thinkingBudget } }
        : {}),
    },
  })

  const text = response.text ?? ''
  const usage = response.usageMetadata
  return {
    text,
    model,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
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

  const text = response.text ?? ''
  const usage = response.usageMetadata
  return {
    text,
    model,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
  }
}
