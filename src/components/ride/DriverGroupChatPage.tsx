import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Ride, User } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  ride_id: string
  sender_id: string
  content: string
  type: string
  meta: Record<string, unknown> | null
  created_at: string
}

interface RiderChat {
  ride: Ride
  rider: Pick<User, 'id' | 'full_name' | 'avatar_url'>
  messages: ChatMessage[]
}

interface DriverGroupChatPageProps {
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverGroupChatPage({
  'data-testid': testId = 'driver-group-chat',
}: DriverGroupChatPageProps) {
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const currentUserId = profile?.id ?? null

  const [riderChats, setRiderChats] = useState<RiderChat[]>([])
  const [activeTab, setActiveTab] = useState<string>('all') // 'all' or rideId
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Fetch rides + messages ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!scheduleId || !currentUserId) return

    const { data: rides } = await supabase
      .from('rides')
      .select('*')
      .eq('schedule_id', scheduleId)
      .or('driver_id.eq.' + currentUserId)
      .in('status', ['coordinating', 'accepted', 'active', 'completed'])
      .order('created_at', { ascending: true })

    if (!rides || rides.length === 0) {
      setLoading(false)
      return
    }

    // Fetch riders
    const riderIds = rides.map((r) => r.rider_id).filter(Boolean) as string[]
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, avatar_url')
      .in('id', [...new Set(riderIds)])

    const userLookup: Record<string, Pick<User, 'id' | 'full_name' | 'avatar_url'>> = {}
    for (const u of users ?? []) {
      userLookup[u.id] = u
    }

    // Fetch messages for all rides
    const rideIds = rides.map((r) => r.id)
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .in('ride_id', rideIds)
      .order('created_at', { ascending: true })

    const msgsByRide: Record<string, ChatMessage[]> = {}
    for (const msg of (messages ?? []) as ChatMessage[]) {
      if (!msgsByRide[msg.ride_id]) msgsByRide[msg.ride_id] = []
      msgsByRide[msg.ride_id]!.push(msg)
    }

    const chats: RiderChat[] = rides
      .filter((r) => r.rider_id)
      .map((r) => ({
        ride: r,
        rider: userLookup[r.rider_id!] ?? { id: r.rider_id!, full_name: 'Rider', avatar_url: null },
        messages: msgsByRide[r.id] ?? [],
      }))

    setRiderChats(chats)
    setLoading(false)
  }, [scheduleId, currentUserId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // ── Realtime subscriptions for all ride chats ──────────────────────────
  useEffect(() => {
    if (riderChats.length === 0) return

    const channels = riderChats.map((rc) =>
      supabase.channel(`chat:${rc.ride.id}:group`)
        .on('broadcast', { event: 'new_message' }, (payload) => {
          const msg = payload.payload as ChatMessage
          setRiderChats((prev) =>
            prev.map((c) =>
              c.ride.id === msg.ride_id
                ? { ...c, messages: [...c.messages, msg] }
                : c,
            ),
          )
        })
        .subscribe(),
    )

    return () => {
      for (const ch of channels) {
        void supabase.removeChannel(ch)
      }
    }
  }, [riderChats.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom on new messages ──────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [riderChats, activeTab])

  // ── Send message ────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return

    // Determine which ride to send to
    let targetRideId: string | null = null
    if (activeTab !== 'all' && riderChats.some((c) => c.ride.id === activeTab)) {
      targetRideId = activeTab
    } else if (riderChats.length === 1) {
      targetRideId = riderChats[0]!.ride.id
    }

    if (!targetRideId) return // Can't send in "All" tab with multiple riders

    setSending(true)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    await fetch(`/api/rides/${targetRideId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: JSON.stringify({ content: input.trim() }),
    })
    setInput('')
    setSending(false)
  }, [input, sending, activeTab, riderChats])

  // ── Visible messages based on active tab ──────────────────────────────
  const visibleMessages: Array<ChatMessage & { riderName: string }> = []
  if (activeTab === 'all') {
    for (const rc of riderChats) {
      for (const msg of rc.messages) {
        visibleMessages.push({ ...msg, riderName: rc.rider.full_name ?? 'Rider' })
      }
    }
    visibleMessages.sort((a, b) => a.created_at.localeCompare(b.created_at))
  } else {
    const chat = riderChats.find((c) => c.ride.id === activeTab)
    if (chat) {
      for (const msg of chat.messages) {
        visibleMessages.push({ ...msg, riderName: chat.rider.full_name ?? 'Rider' })
      }
    }
  }

  const canSend = activeTab !== 'all' || riderChats.length === 1

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div data-testid={testId} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col bg-surface font-sans">
      {/* Header */}
      <div
        className="bg-white border-b border-border px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm text-text-secondary"
            data-testid="back-button"
          >
            ← Back
          </button>
          <h1 className="text-base font-bold text-text-primary">Group Messages</h1>
        </div>

        {/* Tabs */}
        {riderChats.length > 1 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={[
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                activeTab === 'all' ? 'bg-primary text-white' : 'bg-surface text-text-secondary',
              ].join(' ')}
              data-testid="tab-all"
            >
              All
            </button>
            {riderChats.map((rc) => (
              <button
                key={rc.ride.id}
                type="button"
                onClick={() => setActiveTab(rc.ride.id)}
                className={[
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  activeTab === rc.ride.id ? 'bg-primary text-white' : 'bg-surface text-text-secondary',
                ].join(' ')}
                data-testid="tab-rider"
              >
                {rc.rider.full_name?.split(' ')[0] ?? 'Rider'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {visibleMessages.length === 0 && (
          <p className="text-center text-sm text-text-secondary py-8">No messages yet</p>
        )}
        {visibleMessages.map((msg) => {
          const isMe = msg.sender_id === currentUserId
          const showLabel = activeTab === 'all' && !isMe
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[75%] rounded-2xl px-3 py-2',
                  isMe ? 'bg-primary text-white' : 'bg-white text-text-primary border border-border',
                ].join(' ')}
              >
                {showLabel && (
                  <p className="text-[10px] font-semibold text-primary mb-0.5">{msg.riderName}</p>
                )}
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className={`text-[10px] mt-0.5 ${isMe ? 'text-white/60' : 'text-text-secondary'}`}>
                  {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div
        className="bg-white border-t border-border px-4 pt-2 flex gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSend() }}
          placeholder={canSend ? 'Type a message...' : 'Select a rider to send'}
          disabled={!canSend}
          className="flex-1 rounded-2xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none disabled:opacity-50"
          data-testid="chat-input"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend || !input.trim() || sending}
          className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          data-testid="send-button"
        >
          Send
        </button>
      </div>
    </div>
  )
}
