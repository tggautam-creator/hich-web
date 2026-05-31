/**
 * /admin/marketing/advisor — Phase 4 marketing advisor chat.
 *
 * Two-pane: thread sidebar + main chat panel. Brand context loaded
 * server-side; live KPIs injected on the first message of a thread.
 * Gemini 2.5 Pro by default with auto-fallback to Flash on quota.
 */
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useAdvisorThreads,
  useAdvisorThread,
  useCreateAdvisorThread,
  useSendAdvisorMessage,
  useDeleteAdvisorThread,
  type AdvisorMessage,
  type AdvisorThread,
} from '@/hooks/useMarketingAdvisor'
import { costTagline, fallbackBanner } from '@/lib/marketing/costs'
import { NoAiCostBadge, GeminiQuotaBanner, useQuotaGate } from './_shared'

export default function AdvisorPage() {
  const threadsQuery = useAdvisorThreads()
  const createThread = useCreateAdvisorThread()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  // Honor ?thread={id} when the page is deep-linked (e.g. from the
  // DailyFocusBanner's "Talk through this" CTA, which spawns a thread
  // and navigates here). The query param wins over the auto-select
  // when present. We strip it after honoring so re-mounting from
  // history doesn't lock the founder to a stale thread.
  useEffect(() => {
    const deepLinkId = searchParams.get('thread')
    if (deepLinkId && deepLinkId !== activeThreadId) {
      setActiveThreadId(deepLinkId)
      const next = new URLSearchParams(searchParams)
      next.delete('thread')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, activeThreadId, setSearchParams])

  // Auto-select most recent thread when threads load (only if no
  // deep-link winner has been set yet).
  useEffect(() => {
    if (!activeThreadId && threadsQuery.data?.threads?.[0]) {
      setActiveThreadId(threadsQuery.data.threads[0].id)
    }
  }, [activeThreadId, threadsQuery.data])

  async function handleNewThread() {
    // mutateAsync requires the arg explicitly even though the hook's
    // mutationFn signature has it optional — pass undefined.
    const result = await createThread.mutateAsync(undefined)
    setActiveThreadId(result.thread.id)
  }

  return (
    <div data-testid="admin-marketing-advisor" className="flex h-[calc(100vh-180px)] flex-col gap-3">
      <GeminiQuotaBanner />
      <div className="flex flex-1 gap-4 min-h-0">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col rounded-2xl border border-border bg-white overflow-hidden">
        <header className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-text-primary">Conversations</p>
          <div className="flex items-center gap-1">
            <NoAiCostBadge testid="cost-badge-new-thread" />
            <button
              data-testid="new-thread"
              type="button"
              onClick={handleNewThread}
              disabled={createThread.isPending}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              + New
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {threadsQuery.isLoading && (
            <p className="px-3 py-2 text-xs text-text-secondary">Loading…</p>
          )}
          {threadsQuery.data && threadsQuery.data.threads.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-secondary">
              No conversations yet. Click "+ New" to start one.
            </p>
          )}
          {threadsQuery.data?.threads.map((t) => (
            <ThreadListItem
              key={t.id}
              thread={t}
              active={t.id === activeThreadId}
              onClick={() => setActiveThreadId(t.id)}
              onDeleted={(id) => {
                if (id === activeThreadId) setActiveThreadId(null)
              }}
            />
          ))}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col rounded-2xl border border-border bg-white overflow-hidden">
        {activeThreadId ? (
          <ChatPanel threadId={activeThreadId} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-semibold text-text-primary mb-1">
                Start a conversation with your Marketing Advisor
              </p>
              <p className="text-xs text-text-secondary mb-3 max-w-md">
                The agent knows everything about Tago: brand voice, feature
                set, current KPIs, monthly theme, what's worked, what hasn't.
                Ask it strategy questions, brainstorm posts, or get a daily
                focus recommendation.
              </p>
              <button
                type="button"
                onClick={handleNewThread}
                disabled={createThread.isPending}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {createThread.isPending ? 'Starting…' : 'Start new conversation'}
              </button>
              <div className="mt-2 flex justify-center">
                <NoAiCostBadge testid="cost-badge-start-thread" />
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

function ThreadListItem({
  thread, active, onClick, onDeleted,
}: {
  thread: AdvisorThread
  active: boolean
  onClick: () => void
  onDeleted: (id: string) => void
}) {
  const deleteMut = useDeleteAdvisorThread()
  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`Delete "${thread.title}"? This can't be undone.`)) return
    await deleteMut.mutateAsync(thread.id)
    onDeleted(thread.id)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={[
        'group px-3 py-2 cursor-pointer border-b border-border flex items-start justify-between gap-2',
        active ? 'bg-primary/5' : 'hover:bg-surface',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <p className={[
          'text-xs font-semibold truncate',
          active ? 'text-primary' : 'text-text-primary',
        ].join(' ')}>
          {thread.title}
        </p>
        <p className="text-[10px] text-text-secondary mt-0.5">
          {new Date(thread.updated_at).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        aria-label={`Delete "${thread.title}"`}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-text-secondary hover:text-danger px-1"
      >
        ×
      </button>
    </div>
  )
}

function ChatPanel({ threadId }: { threadId: string }) {
  const threadQuery = useAdvisorThread(threadId)
  const sendMut = useSendAdvisorMessage(threadId)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sendGate = useQuotaGate('advisor-message')

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [threadQuery.data?.messages?.length, sendMut.isPending])

  async function handleSend() {
    const content = draft.trim()
    if (content.length < 1 || sendMut.isPending) return
    // Note: the advisor falls back to Flash automatically when Pro
    // 429s on the server, so we do NOT call gate.run() here — a
    // Pro-exhausted send is not actually blocked, and forcing a
    // dismissable alert would be annoying. Instead the gate's
    // status is surfaced inline in the footer.
    setDraft('')
    try {
      await sendMut.mutateAsync(content)
    } catch (err) {
      // Restore draft so the user can edit + retry.
      setDraft(content)
      // eslint-disable-next-line no-console
      console.warn('[advisor] send failed:', err)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <>
      <header className="px-4 py-2 border-b border-border">
        <p className="text-sm font-bold text-text-primary truncate">
          {threadQuery.data?.thread.title ?? 'Loading…'}
        </p>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {threadQuery.isLoading && (
          <p className="text-xs text-text-secondary">Loading thread…</p>
        )}
        {threadQuery.error && (
          <p className="text-xs text-danger">
            Couldn't load thread. {threadQuery.error.message}
          </p>
        )}
        {threadQuery.data && threadQuery.data.messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-text-secondary max-w-md mx-auto">
              First message will pull live KPIs into the advisor's context.
              Try: <span className="italic">"What should I focus on this week?"</span>
            </p>
          </div>
        )}
        {threadQuery.data?.messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        {sendMut.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-surface px-4 py-2 text-xs text-text-secondary italic">
              Thinking…
            </div>
          </div>
        )}
        {sendMut.isSuccess && sendMut.data && (() => {
          // One-shot banner after a send completes: surface when the
          // server's fallback chain picked a non-head model. Sits
          // just under the most recent assistant message, dim.
          const banner = fallbackBanner(sendMut.data.model_used, 'gemini-2.5-pro')
          return banner
            ? (
              <p
                data-testid="advisor-fallback-banner"
                className="text-[10px] text-warning text-center"
              >
                {banner}
              </p>
            )
            : null
        })()}
        {sendMut.isError && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {sendMut.error.message}
          </div>
        )}
      </div>
      <footer className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            data-testid="advisor-compose"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
            onKeyDown={handleKey}
            placeholder="Ask the advisor… (Shift+Enter for newline)"
            rows={2}
            disabled={sendMut.isPending}
            className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 disabled:opacity-50"
          />
          <button
            data-testid="advisor-send"
            type="button"
            onClick={() => void handleSend()}
            disabled={sendMut.isPending || draft.trim().length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-secondary">
          <span title="Cost source: src/lib/marketing/costs.ts. Pro→Flash fallback on quota.">
            {costTagline('advisor-message')} ·{' '}
            {sendGate.quota?.status === 'exhausted'
              ? <span className="text-warning font-semibold">Pro exhausted — using Flash fallback</span>
              : sendGate.quota?.status === 'near'
                ? <span className="text-warning font-semibold">Pro near limit ({sendGate.quota.remaining} left)</span>
                : 'falls back to Flash on quota'}
          </span>
          <span>{draft.length}/4000</span>
        </div>
      </footer>
    </>
  )
}

function MessageBubble({ message }: { message: AdvisorMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-white'
            : 'bg-surface text-text-primary',
        ].join(' ')}
      >
        {message.content}
      </div>
    </div>
  )
}
