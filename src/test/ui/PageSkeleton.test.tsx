/**
 * PageSkeleton tests.
 *
 * Verifies each skeleton variant renders with the correct data-testid.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapPageSkeleton, ListPageSkeleton, FormPageSkeleton } from '@/components/ui/PageSkeleton'

describe('PageSkeleton', () => {
  it('MapPageSkeleton renders with default data-testid', () => {
    render(<MapPageSkeleton />)
    expect(screen.getByTestId('map-page-skeleton')).toBeDefined()
  })

  it('MapPageSkeleton accepts custom data-testid', () => {
    render(<MapPageSkeleton data-testid="custom-map" />)
    expect(screen.getByTestId('custom-map')).toBeDefined()
  })

  it('ListPageSkeleton renders with default data-testid', () => {
    render(<ListPageSkeleton />)
    expect(screen.getByTestId('list-page-skeleton')).toBeDefined()
  })

  it('FormPageSkeleton renders with default data-testid', () => {
    render(<FormPageSkeleton />)
    expect(screen.getByTestId('form-page-skeleton')).toBeDefined()
  })
})
