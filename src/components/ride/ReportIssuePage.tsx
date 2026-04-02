import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface ReportIssuePageProps {
  'data-testid'?: string
}

const CATEGORIES = [
  { value: 'ride', label: 'Ride issue' },
  { value: 'payment', label: 'Payment problem' },
  { value: 'safety', label: 'Safety concern' },
  { value: 'account', label: 'Account issue' },
  { value: 'bug', label: 'App bug' },
  { value: 'other', label: 'Other' },
] as const

const SUPPORT_EMAIL = 'tagorides@gmail.com'

export default function ReportIssuePage({
  'data-testid': testId = 'report-issue-page',
}: ReportIssuePageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const canSubmit = category !== '' && description.trim().length >= 10

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const categoryLabel = CATEGORIES.find((c) => c.value === category)?.label ?? category
    const subject = encodeURIComponent(`[TAGO] ${categoryLabel}`)
    const body = encodeURIComponent(
      `Category: ${categoryLabel}\n` +
      `User: ${profile?.email ?? 'unknown'}\n` +
      `User ID: ${profile?.id ?? 'unknown'}\n\n` +
      `${description.trim()}`,
    )

    window.open(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`, '_self')
    setSubmitted(true)
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
          onClick={() => { navigate('/settings') }}
          className="self-start mb-4 text-sm font-medium text-primary"
        >
          &larr; Back to Settings
        </button>

        <h1 className="mb-2 text-2xl font-bold text-text-primary">Report an issue</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Tell us what went wrong and we&apos;ll look into it.
        </p>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                What&apos;s this about?
              </label>
              <div className="flex flex-wrap gap-2" data-testid="category-options">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    data-testid={`category-${cat.value}`}
                    onClick={() => { setCategory(cat.value) }}
                    className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
                      category === cat.value
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-text-secondary border-border'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="issue-description"
                className="block text-sm font-medium text-text-primary mb-2"
              >
                Describe the issue
              </label>
              <textarea
                id="issue-description"
                data-testid="description-input"
                value={description}
                onChange={(e) => { setDescription(e.target.value) }}
                placeholder="What happened? The more detail, the faster we can help."
                rows={5}
                className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-primary focus:outline-none resize-none"
              />
              <p className="mt-1 text-xs text-text-secondary">
                {description.trim().length < 10
                  ? `At least ${10 - description.trim().length} more characters needed`
                  : 'Looks good'}
              </p>
            </div>

            <PrimaryButton
              data-testid="submit-button"
              type="submit"
              disabled={!canSubmit}
            >
              Send report
            </PrimaryButton>
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 mt-8" data-testid="success-message">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-lg font-semibold text-text-primary">Report sent</h2>
            <p className="text-sm text-text-secondary text-center max-w-xs">
              Your email app should have opened with the report details.
              If it didn&apos;t, email us directly at{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-primary font-medium"
                data-testid="support-email-link"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
            <button
              data-testid="back-to-settings-button"
              onClick={() => { navigate('/settings') }}
              className="mt-2 text-sm font-medium text-primary"
            >
              Back to Settings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
