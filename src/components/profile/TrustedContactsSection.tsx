/**
 * v1.3 Sprint 11 Slice 2 — "Trusted Contacts" section on the Profile
 * page.
 *
 * Mirrors iOS `ProfileSafetySection.swift` end-to-end:
 *   - Loading state with small spinner + "Loading trusted contacts…"
 *     copy.
 *   - Load error state with retry button (auto-retry-once is
 *     handled inside `useMyTrustedContacts` via React Query
 *     `retry: 1` + `retryDelay: 1000`, mirroring iOS's
 *     `Task.sleep(1s)` retry path in
 *     `ProfileSafetySection.load()`).
 *   - Empty state: "No trusted contacts yet" + cap-substituted hint
 *     copy (`Add up to 5 people you'd want to reach in an
 *     emergency.…`), VERBATIM against iOS.
 *   - List of up to 5 contacts (name + phone, danger-tinted avatar).
 *   - Per-row delete button with confirmation dialog: "Remove this
 *     contact?" + "They won't receive your live-tracking link in
 *     an emergency." (VERBATIM against iOS
 *     `ProfileSafetySection.swift:78-93`).
 *   - Add button (hidden at count >= 5 — defence-in-depth alongside
 *     the server's 409 LIMIT_REACHED): "Add your first trusted
 *     contact" (empty) / "Add another contact" (non-empty),
 *     mirroring iOS contacts.isEmpty branching.
 *
 * Endpoints:
 *   - GET    /api/safety/trusted-contacts
 *   - POST   /api/safety/trusted-contacts
 *   - DELETE /api/safety/trusted-contacts/:id
 */
import { useState } from 'react'
import {
  useDeleteTrustedContact,
  useMyTrustedContacts,
} from '@/hooks/useTrustedContacts'
import { TrustedContactApiError, type TrustedContact } from '@/lib/trustedContactsApi'
import AddTrustedContactSheet from '@/components/profile/AddTrustedContactSheet'

const CAP = 5

const EMPTY_HINT = `Add up to ${CAP} people you'd want to reach in an emergency. They'll receive your live-tracking link with one tap from the Safety menu during a ride.`

interface TrustedContactsSectionProps {
  'data-testid'?: string
}

function describeError(err: Error | null): string {
  if (!err) return ''
  if (err instanceof TrustedContactApiError) {
    if (err.code === 'LIMIT_REACHED') return 'You can save up to 5 trusted contacts.'
    return err.message
  }
  return err.message
}

export default function TrustedContactsSection({
  'data-testid': testId = 'trusted-contacts-section',
}: TrustedContactsSectionProps) {
  const { data: contacts, isLoading, error, refetch, isFetching } = useMyTrustedContacts()
  const deleteMutation = useDeleteTrustedContact()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const list: TrustedContact[] = contacts ?? []
  const atCap = list.length >= CAP

  async function confirmDelete() {
    if (!pendingDeleteId) return
    try {
      await deleteMutation.mutateAsync(pendingDeleteId)
    } catch {
      // Surface via the mutation's `error` state below — swallow so
      // the confirm dialog still closes cleanly.
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <>
      <section
        data-testid={testId}
        className="bg-white mx-4 mt-4 rounded-2xl border border-border overflow-hidden"
      >
        <h2 className="px-5 pt-4 pb-2 text-sm font-semibold text-text-primary">
          Trusted Contacts
        </h2>

        {isLoading && (
          <p
            data-testid="trusted-contacts-loading"
            className="px-5 py-4 text-xs text-text-secondary"
          >
            Loading trusted contacts…
          </p>
        )}

        {error && !isLoading && (
          <div
            data-testid="trusted-contacts-load-error"
            className="px-5 py-4 text-xs text-danger"
          >
            <p className="mb-2">Tap retry — couldn’t reach the server.</p>
            <button
              type="button"
              onClick={() => { void refetch() }}
              disabled={isFetching}
              className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-60"
              data-testid="trusted-contacts-retry"
            >
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {!isLoading && !error && list.length === 0 && (
          <div
            data-testid="trusted-contacts-empty"
            className="px-5 py-4"
          >
            <p className="text-sm text-text-secondary">No trusted contacts yet</p>
            <p className="mt-1 text-xs text-text-secondary">{EMPTY_HINT}</p>
          </div>
        )}

        {!isLoading && !error && list.length > 0 && (
          <ul className="divide-y divide-border" data-testid="trusted-contacts-list">
            {list.map((contact) => (
              <li
                key={contact.id}
                data-testid={`trusted-contact-row-${contact.id}`}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger"
                  aria-hidden="true"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v1h16v-1c0-3.31-3.58-6-8-6Z" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{contact.name}</p>
                  <p className="truncate text-xs text-text-secondary">{contact.phone}</p>
                </div>
                <button
                  type="button"
                  data-testid={`trusted-contact-delete-${contact.id}`}
                  aria-label={`Remove ${contact.name}`}
                  onClick={() => setPendingDeleteId(contact.id)}
                  disabled={deleteMutation.isPending && pendingDeleteId === contact.id}
                  className="rounded-lg p-2 text-danger transition-colors active:bg-danger/10 disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M3 6h18" />
                    <path d="M19 6 17.5 20a2 2 0 0 1-2 1.8h-7A2 2 0 0 1 6.5 20L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && !error && !atCap && (
          <button
            type="button"
            data-testid="trusted-contacts-add"
            onClick={() => setSheetOpen(true)}
            className="flex w-full items-center gap-2 border-t border-border px-5 py-3 text-sm font-semibold text-primary transition-colors active:bg-primary/5"
          >
            <span aria-hidden="true" className="text-lg leading-none">＋</span>
            <span>
              {list.length === 0 ? 'Add your first trusted contact' : 'Add another contact'}
            </span>
          </button>
        )}

        {!deleteMutation.isPending && deleteMutation.error && (
          <p
            data-testid="trusted-contacts-action-error"
            className="px-5 pb-3 pt-1 text-xs text-danger"
            role="alert"
          >
            Couldn’t update contact — {describeError(deleteMutation.error)}
          </p>
        )}
      </section>

      <AddTrustedContactSheet
        isOpen={sheetOpen}
        onSaved={() => setSheetOpen(false)}
        onClose={() => setSheetOpen(false)}
      />

      {pendingDeleteId !== null && (
        <div
          data-testid="trusted-contacts-confirm-delete"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="trusted-contact-confirm-title"
          aria-describedby="trusted-contact-confirm-message"
          className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-0"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 id="trusted-contact-confirm-title" className="text-base font-semibold text-text-primary">
              Remove this contact?
            </h3>
            <p id="trusted-contact-confirm-message" className="mt-2 text-sm text-text-secondary">
              They won&apos;t receive your live-tracking link in an emergency.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                data-testid="trusted-contacts-confirm-cancel"
                onClick={() => setPendingDeleteId(null)}
                className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-primary active:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="trusted-contacts-confirm-remove"
                onClick={() => { void confirmDelete() }}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-2xl bg-danger py-3 text-sm font-semibold text-white active:bg-danger/90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
