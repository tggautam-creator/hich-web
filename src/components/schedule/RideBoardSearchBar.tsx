interface RideBoardSearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  'data-testid'?: string
}

export default function RideBoardSearchBar({
  query,
  onQueryChange,
  'data-testid': testId = 'board-search-bar',
}: RideBoardSearchBarProps) {
  return (
    <div data-testid={testId} className="relative">
      {/* Search icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <input
        data-testid="board-search-input"
        type="text"
        placeholder="Where are you going?"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="w-full rounded-2xl border border-border bg-white pl-10 pr-10 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
      />

      {/* Clear button */}
      {query.length > 0 && (
        <button
          data-testid="board-search-clear"
          onClick={() => onQueryChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-text-secondary/20 text-text-secondary active:bg-text-secondary/30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  )
}
