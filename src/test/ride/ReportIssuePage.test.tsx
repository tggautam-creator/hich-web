import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReportIssuePage from '@/components/ride/ReportIssuePage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; email: string } }) => unknown) =>
    selector({ profile: { id: 'u-1', email: 'maya@ucdavis.edu' } }),
}))

describe('ReportIssuePage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('renders the page', () => {
    render(<ReportIssuePage />)
    expect(screen.getByTestId('report-issue-page')).toBeDefined()
    expect(screen.getByText('Report an issue')).toBeDefined()
  })

  it('renders category options', () => {
    render(<ReportIssuePage />)
    expect(screen.getByTestId('category-options')).toBeDefined()
    expect(screen.getByTestId('category-ride')).toBeDefined()
    expect(screen.getByTestId('category-payment')).toBeDefined()
    expect(screen.getByTestId('category-safety')).toBeDefined()
    expect(screen.getByTestId('category-bug')).toBeDefined()
    expect(screen.getByTestId('category-other')).toBeDefined()
  })

  it('submit button is disabled without category and description', () => {
    render(<ReportIssuePage />)
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is disabled with category but short description', () => {
    render(<ReportIssuePage />)
    fireEvent.click(screen.getByTestId('category-ride'))
    fireEvent.change(screen.getByTestId('description-input'), { target: { value: 'short' } })
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is enabled with category and valid description', () => {
    render(<ReportIssuePage />)
    fireEvent.click(screen.getByTestId('category-ride'))
    fireEvent.change(screen.getByTestId('description-input'), {
      target: { value: 'The driver never showed up at pickup.' },
    })
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  it('opens mailto link on submit', () => {
    render(<ReportIssuePage />)
    fireEvent.click(screen.getByTestId('category-ride'))
    fireEvent.change(screen.getByTestId('description-input'), {
      target: { value: 'The driver never showed up at pickup.' },
    })
    fireEvent.click(screen.getByTestId('submit-button'))
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('mailto:tagorides@gmail.com'),
      '_self',
    )
  })

  it('shows success message after submit', () => {
    render(<ReportIssuePage />)
    fireEvent.click(screen.getByTestId('category-ride'))
    fireEvent.change(screen.getByTestId('description-input'), {
      target: { value: 'The driver never showed up at pickup.' },
    })
    fireEvent.click(screen.getByTestId('submit-button'))
    expect(screen.getByTestId('success-message')).toBeDefined()
    expect(screen.getByText('Report sent')).toBeDefined()
  })

  it('navigates back to settings', () => {
    render(<ReportIssuePage />)
    fireEvent.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings')
  })

  it('selects a category on click', () => {
    render(<ReportIssuePage />)
    const btn = screen.getByTestId('category-payment')
    fireEvent.click(btn)
    expect(btn.className).toContain('bg-primary')
  })
})
