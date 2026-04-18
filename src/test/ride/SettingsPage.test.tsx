import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPage from '@/components/ride/SettingsPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

const mockSignOut = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string }; signOut: () => Promise<void> }) => unknown) =>
    selector({ profile: { id: 'u-1' }, signOut: mockSignOut }),
}))

const mockUpdateUser = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { updateUser: (...args: unknown[]) => mockUpdateUser(...args) },
    from: () => ({ update: mockUpdate }),
  },
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockSignOut.mockClear()
    mockUpdateUser.mockClear()
    localStorage.clear()
  })

  it('renders the page', () => {
    render(<SettingsPage />)
    expect(screen.getByTestId('settings-page')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
  })

  it('shows notification toggles', () => {
    render(<SettingsPage />)
    expect(screen.getByTestId('toggle-push-rides')).toBeDefined()
    expect(screen.getByTestId('toggle-push-promos')).toBeDefined()
    expect(screen.getByTestId('toggle-email')).toBeDefined()
  })

  it('toggles notification preference', () => {
    render(<SettingsPage />)
    const toggle = screen.getByTestId('toggle-push-rides')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(localStorage.getItem('pref_push_rides')).toBe('false')
  })

  it('navigates back to profile', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('shows change password form', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('change-password-button'))
    expect(screen.getByTestId('new-password-input')).toBeDefined()
    expect(screen.getByTestId('confirm-password-input')).toBeDefined()
  })

  it('validates password length', async () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('change-password-button'))
    const newPw = screen.getByTestId('new-password-input')
    const confirmPw = screen.getByTestId('confirm-password-input')
    fireEvent.change(newPw, { target: { value: 'short' } })
    fireEvent.change(confirmPw, { target: { value: 'short' } })
    fireEvent.click(screen.getByTestId('save-password-button'))
    expect(await screen.findByTestId('password-error')).toBeDefined()
    expect(screen.getByTestId('password-error').textContent).toBe('Password must be at least 8 characters')
  })

  it('validates password match', async () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('change-password-button'))
    fireEvent.change(screen.getByTestId('new-password-input'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByTestId('confirm-password-input'), { target: { value: 'different1' } })
    fireEvent.click(screen.getByTestId('save-password-button'))
    expect(await screen.findByTestId('password-error')).toBeDefined()
    expect(screen.getByTestId('password-error').textContent).toBe('Passwords do not match')
  })

  it('shows delete account confirmation', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('delete-account-button'))
    expect(screen.getByTestId('confirm-delete-button')).toBeDefined()
    expect(screen.getByTestId('cancel-delete-button')).toBeDefined()
  })

  it('cancels delete account', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('delete-account-button'))
    fireEvent.click(screen.getByTestId('cancel-delete-button'))
    expect(screen.getByTestId('delete-account-button')).toBeDefined()
  })

  it('shows report issue button', () => {
    render(<SettingsPage />)
    expect(screen.getByTestId('report-issue-button')).toBeDefined()
    expect(screen.getByText('Report an issue')).toBeDefined()
  })

  it('navigates to report issue page', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId('report-issue-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/report-issue')
  })

  it('shows about section', () => {
    render(<SettingsPage />)
    expect(screen.getByText('Version 1.0.0')).toBeDefined()
    expect(screen.getByText('Made with love in Davis, CA')).toBeDefined()
  })
})
