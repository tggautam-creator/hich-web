import AppIcon from '@/components/ui/AppIcon'

interface RideBoardEmptyStateProps {
  searchQuery: string
  onPostRide: () => void
  'data-testid'?: string
}

export default function RideBoardEmptyState({
  searchQuery,
  onPostRide,
}: RideBoardEmptyStateProps) {
  const hasSearch = searchQuery.trim().length > 0

  return (
    <div className="text-center py-12">
      <div className="flex justify-center mb-3">
        <div className="h-14 w-14 rounded-full bg-surface flex items-center justify-center">
          <AppIcon name={hasSearch ? 'search' : 'car-request'} className="h-7 w-7 text-text-secondary" />
        </div>
      </div>
      <p className="text-text-secondary text-sm mb-4">
        {hasSearch
          ? `No rides matching "${searchQuery}" yet.`
          : 'No rides posted yet. Be the first!'}
      </p>
      <button
        data-testid="empty-post-button"
        onClick={onPostRide}
        className="px-6 py-3 bg-primary text-white font-semibold rounded-2xl"
      >
        Post a Ride
      </button>
    </div>
  )
}
