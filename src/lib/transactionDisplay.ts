/**
 * Shared display helpers for wallet transaction rows.
 *
 * Used by both the wallet hub (recent-activity preview) and the
 * dedicated /wallet/history page. Lifted from WalletPage so the two
 * surfaces can't drift on labels / icons / withdrawal pill logic.
 *
 * iOS reference: ios/Tago/Features/Payment/TransactionRow.swift.
 */

export interface WalletTransaction {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  created_at: string
  ride_id?: string | null
  counterparty_name?: string | null
  transfer_id?: string | null
}

export function typeLabel(type: string): string {
  switch (type) {
    case 'topup': return 'Added funds'
    case 'fare_debit': return 'Ride fare'
    case 'fare_credit': return 'Ride earnings'
    case 'ride_earning': return 'Ride earnings'
    case 'fare_reversal': return 'Refunded — payment failed'
    case 'wallet_refund': return 'Refund — payment failed'
    case 'refund': return 'Refund'
    case 'tip_debit': return 'Tip to driver'
    case 'tip_credit': return 'Tip from rider'
    case 'withdrawal': return 'Withdrawal to bank'
    case 'withdrawal_failed_refund': return 'Refund — withdrawal failed'
    default: return type
  }
}

/**
 * Slice 8 — refund/reversal rows get a finer-grained label parsed
 * from the server-written description prefix so the rider/driver
 * can tell *why* the refund happened. Returns null when the prefix
 * doesn't match any known case (caller falls back to typeLabel).
 */
export function refinedRefundLabel(tx: WalletTransaction): string | null {
  const desc = (tx.description ?? '').toLowerCase()
  if (tx.type === 'wallet_refund') {
    if (desc.includes('no card on file')) return 'Refund · no card on file'
    if (desc.includes('card charge failed')) return 'Refund · card charge failed'
    if (desc.includes('card portion failed') || desc.includes('rider wallet restored')) return 'Refund · card payment failed'
  }
  if (tx.type === 'fare_reversal') {
    if (desc.includes('test-mode')) return 'Reversed · test-mode cleanup'
    if (desc.includes('rider payment failed')) return 'Reversed · rider payment failed'
  }
  if (tx.type === 'withdrawal_failed_refund') {
    return 'Refund · withdrawal failed at bank'
  }
  return null
}

export function transactionTitle(tx: WalletTransaction): string {
  const refined = refinedRefundLabel(tx)
  const base = refined ?? typeLabel(tx.type)
  if (tx.counterparty_name && tx.ride_id) {
    return `${base} · ${tx.counterparty_name}`
  }
  return refined ?? tx.description ?? base
}

export function typeIcon(type: string): string {
  switch (type) {
    case 'topup': return '+'
    case 'fare_credit': return '+'
    case 'ride_earning': return '+'
    case 'wallet_refund': return '+'
    case 'tip_credit': return '+'
    case 'withdrawal_failed_refund': return '+'
    case 'fare_debit': return '−'
    case 'fare_reversal': return '−'
    case 'tip_debit': return '−'
    case 'withdrawal': return '−'
    case 'refund': return '+'
    default: return ''
  }
}

export function isCredit(type: string): boolean {
  return type === 'topup' || type === 'fare_credit' || type === 'ride_earning'
    || type === 'wallet_refund' || type === 'refund' || type === 'tip_credit'
    || type === 'withdrawal_failed_refund'
}

export function isDriverEarning(type: string): boolean {
  return type === 'ride_earning' || type === 'fare_credit'
}

/**
 * Stripe doesn't expose a platform-level event for "money landed in
 * the connected account's bank" anymore. We approximate by adding 2
 * business days to the withdrawal's created_at: until that date the
 * row reads "in transit", after it reads "landed in your bank".
 * Accurate within ~1 day for ~99% of transfers and matches the copy
 * in WithdrawSheet's success state.
 */
export function withdrawalEtaDate(createdAt: string): Date {
  const d = new Date(createdAt)
  let added = 0
  while (added < 2) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

export function withdrawalEta(createdAt: string): string {
  return withdrawalEtaDate(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatTxDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * iOS TransactionHistoryPage.dayLabel — "Today" / "Yesterday" / "Apr 26"
 * / "Apr 26, 2024". Drives the day-grouped section headers on the
 * dedicated history page.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
  if (sameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Groups transactions by calendar day, preserving newest-first
 * iteration order. Mirrors iOS TransactionHistoryPage.groupedByDay.
 */
export function groupByDay(
  transactions: WalletTransaction[],
  now: Date = new Date(),
): Array<{ label: string; rows: WalletTransaction[] }> {
  const ordered: Array<{ label: string; rows: WalletTransaction[] }> = []
  for (const tx of transactions) {
    const label = dayLabel(tx.created_at, now)
    const last = ordered[ordered.length - 1]
    if (last && last.label === label) {
      last.rows.push(tx)
    } else {
      ordered.push({ label, rows: [tx] })
    }
  }
  return ordered
}
