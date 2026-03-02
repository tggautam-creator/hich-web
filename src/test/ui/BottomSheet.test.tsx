import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BottomSheet from '@/components/ui/BottomSheet'

// jsdom doesn't have portal-root by default — create it before each test
beforeEach(() => {
  let portal = document.getElementById('portal-root')
  if (!portal) {
    portal = document.createElement('div')
    portal.id = 'portal-root'
    document.body.appendChild(portal)
  }
})

describe('BottomSheet — visibility', () => {
  it('renders children when isOpen is true', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()}>
        <p>Sheet content</p>
      </BottomSheet>,
    )
    expect(screen.getByText('Sheet content')).toBeDefined()
  })

  it('renders nothing when isOpen is false', () => {
    render(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        <p>Hidden content</p>
      </BottomSheet>,
    )
    expect(screen.queryByText('Hidden content')).toBeNull()
  })
})

describe('BottomSheet — title and testid', () => {
  it('renders the title when provided', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()} title="Pick a time">
        <span>body</span>
      </BottomSheet>,
    )
    expect(screen.getByText('Pick a time')).toBeDefined()
  })

  it('accepts data-testid', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()} data-testid="sheet">
        <span>body</span>
      </BottomSheet>,
    )
    expect(screen.getByTestId('sheet')).toBeDefined()
  })

  it('has role=dialog', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()}>
        <span>body</span>
      </BottomSheet>,
    )
    expect(screen.getByRole('dialog')).toBeDefined()
  })
})

describe('BottomSheet — close behaviour', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose}>
        <span>body</span>
      </BottomSheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose} data-testid="sheet">
        <span>body</span>
      </BottomSheet>,
    )
    // backdrop is the element with aria-hidden=true
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
