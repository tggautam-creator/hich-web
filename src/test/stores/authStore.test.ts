import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '@/stores/authStore'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const {
  mockOnAuthStateChange,
  mockGetSession,
  mockSupabaseSignOut,
  mockFrom,
} = vi.hoisted(() => ({
  mockOnAuthStateChange:  vi.fn(),
  mockGetSession:         vi.fn(),
  mockSupabaseSignOut:    vi.fn(),
  mockFrom:               vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mockOnAuthStateChange,
      getSession:        mockGetSession,
      signOut:           mockSupabaseSignOut,
    },
    from: mockFrom,
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeUser    = { id: 'user-1', email: 'maya@ucdavis.edu' }
const fakeSession = { access_token: 'tok', user: fakeUser }
const fakeProfile = {
  id:                 'user-1',
  email:              'maya@ucdavis.edu',
  full_name:          'Maya Johnson',
  phone:              '+15551234567',
  avatar_url:         null,
  wallet_balance:     0,
  stripe_customer_id: null,
  is_driver:          false,
  rating_avg:         null,
  rating_count:       0,
  home_location:      null,
  stripe_account_id:  null,
  stripe_onboarding_complete: false,
  default_payment_method_id: null,
  phone_verified: false,
  date_of_birth:      null,
  onboarding_completed: false,
  is_admin:           false,
  created_at:         '2024-01-01T00:00:00Z',
}

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Wires up mockFrom so that `.from('users').select('*').eq(...).single()`
 * resolves with the given result.
 */
function mockProfileQuery(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockEq     = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Reset the store to its initial state before each test
  useAuthStore.setState({
    user:      null,
    session:   null,
    profile:   null,
    isLoading: true,
    isDriver:  false,
  })

  // Default: fire INITIAL_SESSION with null (no existing session).
  // The callback is invoked asynchronously to match real Supabase behavior.
  mockOnAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    queueMicrotask(() => callback('INITIAL_SESSION', null))
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mockGetSession.mockResolvedValue({ data: { session: null } })
  mockSupabaseSignOut.mockResolvedValue({ error: null })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAuthStore — initial state', () => {
  it('starts with all null auth fields and isLoading=true', () => {
    const { user, session, profile, isLoading, isDriver } = useAuthStore.getState()
    expect(user).toBeNull()
    expect(session).toBeNull()
    expect(profile).toBeNull()
    expect(isLoading).toBe(true)
    expect(isDriver).toBe(false)
  })
})

// ── initialize() ──────────────────────────────────────────────────────────────

describe('useAuthStore — initialize()', () => {
  it('returns a cleanup (unsubscribe) function', () => {
    const cleanup = useAuthStore.getState().initialize()
    expect(typeof cleanup).toBe('function')
  })

  it('sets isLoading=false and session=null when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    useAuthStore.getState().initialize()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().profile).toBeNull()
  })

  it('loads session + profile when a session exists', async () => {
    mockOnAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
      queueMicrotask(() => callback('INITIAL_SESSION', fakeSession))
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } })
    mockProfileQuery({ data: fakeProfile, error: null })

    useAuthStore.getState().initialize()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    const state = useAuthStore.getState()
    expect(state.session).toEqual(fakeSession)
    expect(state.profile).toEqual(fakeProfile)
    expect(state.isDriver).toBe(false)
  })

  it('sets isDriver=true when profile.is_driver is true', async () => {
    const driverProfile = { ...fakeProfile, is_driver: true }
    mockOnAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
      queueMicrotask(() => callback('INITIAL_SESSION', fakeSession))
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } })
    mockProfileQuery({ data: driverProfile, error: null })

    useAuthStore.getState().initialize()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    expect(useAuthStore.getState().isDriver).toBe(true)
  })

  it('clears profile on SIGNED_OUT event from the auth listener', () => {
    let capturedCb: ((event: string, session: null) => void) | null = null
    mockOnAuthStateChange.mockImplementation((cb: unknown) => {
      capturedCb = cb as (event: string, session: null) => void
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })

    // Pre-populate the store as if the user was signed in
    useAuthStore.setState({
      user:    fakeUser as never,
      session: fakeSession as never,
      profile: fakeProfile,
      isLoading: false,
    })

    useAuthStore.getState().initialize()
    capturedCb!('SIGNED_OUT', null)

    const state = useAuthStore.getState()
    expect(state.profile).toBeNull()
    expect(state.isDriver).toBe(false)
    expect(state.session).toBeNull()
  })

  it('fetches profile on SIGNED_IN event from the auth listener', async () => {
    let capturedCb: ((event: string, session: unknown) => void) | null = null
    mockOnAuthStateChange.mockImplementation((cb: unknown) => {
      capturedCb = cb as (event: string, session: unknown) => void
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockProfileQuery({ data: fakeProfile, error: null })

    useAuthStore.getState().initialize()
    capturedCb!('SIGNED_IN', fakeSession)

    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile).toEqual(fakeProfile)
    })
  })

  it('calls unsubscribe when the returned cleanup is invoked', () => {
    const mockUnsubscribe = vi.fn()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })

    const cleanup = useAuthStore.getState().initialize()
    cleanup()

    expect(mockUnsubscribe).toHaveBeenCalledOnce()
  })
})

// ── signOut() ─────────────────────────────────────────────────────────────────

describe('useAuthStore — signOut()', () => {
  it('clears all auth state and calls supabase.auth.signOut()', async () => {
    useAuthStore.setState({
      user:      fakeUser as never,
      session:   fakeSession as never,
      profile:   fakeProfile,
      isDriver:  false,
      isLoading: false,
    })

    await useAuthStore.getState().signOut()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.session).toBeNull()
    expect(state.profile).toBeNull()
    expect(state.isDriver).toBe(false)
    expect(state.isLoading).toBe(false)
    expect(mockSupabaseSignOut).toHaveBeenCalledOnce()
  })
})

// ── refreshProfile() ──────────────────────────────────────────────────────────

describe('useAuthStore — refreshProfile()', () => {
  it('fetches the users-table row and updates profile + isDriver', async () => {
    useAuthStore.setState({ user: fakeUser as never, isLoading: true })
    mockProfileQuery({ data: fakeProfile, error: null })

    await useAuthStore.getState().refreshProfile()

    const state = useAuthStore.getState()
    expect(state.profile).toEqual(fakeProfile)
    expect(state.isDriver).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('sets isDriver=true when profile row has is_driver=true', async () => {
    const driverProfile = { ...fakeProfile, is_driver: true }
    useAuthStore.setState({ user: fakeUser as never, isLoading: true })
    mockProfileQuery({ data: driverProfile, error: null })

    await useAuthStore.getState().refreshProfile()

    expect(useAuthStore.getState().isDriver).toBe(true)
  })

  it('skips DB query and preserves isLoading when there is no user', async () => {
    useAuthStore.setState({ user: null, isLoading: true })

    await useAuthStore.getState().refreshProfile()

    // isLoading stays true — recovery path handles it, not refreshProfile
    expect(useAuthStore.getState().isLoading).toBe(true)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('sets profile=null and isLoading=false on a DB error', async () => {
    useAuthStore.setState({ user: fakeUser as never, isLoading: true })
    mockProfileQuery({ data: null, error: new Error('db error') })

    await useAuthStore.getState().refreshProfile()

    const state = useAuthStore.getState()
    expect(state.profile).toBeNull()
    expect(state.isDriver).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('sets profile=null and isLoading=false when DB returns null data without error', async () => {
    useAuthStore.setState({ user: fakeUser as never, isLoading: true })
    mockProfileQuery({ data: null, error: null })

    await useAuthStore.getState().refreshProfile()

    expect(useAuthStore.getState().profile).toBeNull()
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})
