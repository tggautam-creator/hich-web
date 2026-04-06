import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface RideReportPageProps {
  'data-testid'?: string
}

const CATEGORIES = [
  { value: 'driver_behavior', label: 'Driver behavior', examples: 'Rude, unsafe driving, harassment, no-show' },
  { value: 'rider_behavior',  label: 'Rider behavior',  examples: 'Rude, harassment, property damage, no-show' },
  { value: 'payment',         label: 'Payment issue',   examples: 'Wrong charge, payment failed, fare dispute' },
  { value: 'safety',          label: 'Safety concern',  examples: 'Felt unsafe, accident, emergency' },
  { value: 'bug',             label: 'App bug',         examples: "Something in the app didn't work" },
] as const

export default function RideReportPage({
  'data-testid': testId = 'ride-report-page',
}: RideReportPageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()

  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = category !== '' && description.trim().length >= 10

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const res = await fetch('/api/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          category,
          description: description.trim(),
          ride_id: rideId ?? null,
        }),
      })

      if (!res.ok) throw new Error('Failed to submit report')
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 2rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="flex-1 flex flex-col px-6 py-4">
        <button
          data-testid="back-button"
          onClick={() => navigate(-1)}
          className="self-start mb-4 text-sm font-medium text-primary"
        >
          &larr; Back
        </button>

        <h1 className="mb-1 text-2xl font-bold text-text-primary">Report this ride</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Tell us what happened and we&apos;ll look into it.
        </p>

        {!submitted ? (
          <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-col gap-6">
            {/* Category */}
            <div>
              <p className="text-sm font-medium text-text-primary mb-3">What happened?</p>
              <div className="flex flex-col gap-2" data-testid="category-options">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    data-testid={`category-${cat.value}`}
                    onClick={() => setCategory(cat.value)}
                    className={[
                      'w-full rounded-2xl px-4 py-3 text-left border transition-colors',
                      category === cat.value
                        ? 'bg-primary/5 border-primary'
                        : 'bg-white border-border',
                    ].join(' ')}
                  >
                    <p className={`text-sm font-semibold ${category === cat.value ? 'text-primary' : 'text-text-primary'}`}>
                      {cat.label}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">{cat.examples}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="report-description"
                className="block text-sm font-medium text-text-primary mb-2"
              >
                Describe what happened
              </label>
              <textarea
                id="report-description"
                data-testid="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="The more detail you give us, the faster we can investigate."
                rows={5}
                className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-primary focus:outline-none resize-none"
              />
              <p className="mt-1 text-xs text-text-secondary">
                {description.trim().length < 10
                  ? `At least ${10 - description.trim().length} more characters needed`
                  : 'Looks good'}
              </p>
            </div>

            {error && (
              <p className="text-sm text-danger" role="alert">{error}</p>
            )}

            <PrimaryButton
              data-testid="submit-button"
              type="submit"
              disabled={!canSubmit}
              isLoading={submitting}
            >
              Submit report
            </PrimaryButton>
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 mt-8" data-testid="success-message">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-lg font-semibold text-text-primary">Report received</h2>
            <p className="text-sm text-text-secondary text-center max-w-xs">
              Thanks for letting us know. We&apos;ll review it and take action if needed.
            </p>
            <button
              data-testid="done-button"
              onClick={() => navigate(-1)}
              className="mt-2 text-sm font-medium text-primary"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
