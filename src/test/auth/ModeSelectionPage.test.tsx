import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ModeSelectionPage from '@/components/auth/ModeSelectionPage'

// ── Mocks ────────────────────────────────────────────────────────────────────
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ModeSelectionPage />
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('ModeSelectionPage', () => {
  describe('rendering', () => {
    it('renders the page with correct testid', () => {
      renderPage()
      expect(screen.getByTestId('mode-selection-page')).toBeDefined()
    })

    it('shows heading', () => {
      renderPage()
      expect(screen.getByText('How will you use HICH?')).toBeDefined()
    })

    it('renders all three mode cards', () => {
      renderPage()
      expect(screen.getByTestId('mode-rider')).toBeDefined()
      expect(screen.getByTestId('mode-driver')).toBeDefined()
      expect(screen.getByTestId('mode-both')).toBeDefined()
    })

    it('shows rider card text', () => {
      renderPage()
      expect(screen.getByText('I need rides')).toBeDefined()
    })

    it('shows driver card text', () => {
      renderPage()
      expect(screen.getByText('I offer rides')).toBeDefined()
    })

    it('shows both card text', () => {
      renderPage()
      expect(screen.getByText('I do both')).toBeDefined()
    })
  })

  describe('navigation', () => {
    it('navigates to /home/rider when rider card is clicked', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('mode-rider'))
      expect(mockNavigate).toHaveBeenCalledWith('/home/rider')
    })

    it('navigates to /onboarding/vehicle when driver card is clicked', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('mode-driver'))
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/vehicle')
    })

    it('navigates to /onboarding/vehicle when both card is clicked', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('mode-both'))
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/vehicle')
    })
  })
})
