/**
 * Page-level loading skeletons for React.lazy code splitting.
 *
 * Three variants matching the app's common page layouts:
 *  - MapPageSkeleton  — full-screen map + bottom card
 *  - ListPageSkeleton — header bar + card list
 *  - FormPageSkeleton — header + form field placeholders
 */

interface SkeletonProps {
  'data-testid'?: string
}

export function MapPageSkeleton({ 'data-testid': testId }: SkeletonProps) {
  return (
    <div data-testid={testId ?? 'map-page-skeleton'} className="flex flex-col h-screen bg-surface">
      {/* Map area */}
      <div className="flex-1 animate-pulse bg-border" />
      {/* Bottom card */}
      <div className="p-4 space-y-3">
        <div className="h-4 w-3/4 animate-pulse rounded bg-border" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-border" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-border" />
      </div>
    </div>
  )
}

export function ListPageSkeleton({ 'data-testid': testId }: SkeletonProps) {
  return (
    <div data-testid={testId ?? 'list-page-skeleton'} className="flex flex-col h-screen bg-surface">
      {/* Header */}
      <div className="h-14 animate-pulse bg-border" />
      {/* Card list */}
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-border" />
        ))}
      </div>
    </div>
  )
}

export function FormPageSkeleton({ 'data-testid': testId }: SkeletonProps) {
  return (
    <div data-testid={testId ?? 'form-page-skeleton'} className="flex flex-col h-screen bg-surface">
      {/* Header */}
      <div className="h-14 animate-pulse bg-border" />
      {/* Form fields */}
      <div className="p-6 space-y-4">
        <div className="h-5 w-1/3 animate-pulse rounded bg-border" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-border" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-border" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-border" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-border" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-border" />
        <div className="h-12 w-full animate-pulse rounded-lg bg-primary/20 mt-4" />
      </div>
    </div>
  )
}
