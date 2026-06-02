/**
 * Admin hooks for lifecycle email template management.
 * Backs /admin/marketing/emails — list, edit, preview, test-send,
 * and view per-template send history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPatch, adminPost } from '@/lib/admin/api'

export interface EmailTemplateRow {
  id: string
  key: string
  name: string
  subject: string
  body_markdown: string
  from_email: string
  from_name: string
  reply_to: string | null
  variables: string[]
  is_active: boolean
  trigger_event: string
  delay_hours: number
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface EmailSendRow {
  id: string
  user_id: string
  template_key: string
  recipient_email: string
  subject_at_send: string | null
  body_html_at_send: string | null
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
  provider_message_id: string | null
  error: string | null
  attempt_count: number
  is_test: boolean
  sent_at: string | null
  failed_at: string | null
  created_at: string
}

export interface FromAllowlistEntry {
  value: string
  label: string
}

interface ListResponse {
  ok: true
  templates: EmailTemplateRow[]
  from_address_allowlist: FromAllowlistEntry[]
}

interface DetailResponse {
  ok: true
  template: EmailTemplateRow
  preview: { subject: string; html: string; markdown: string }
  recent_sends: EmailSendRow[]
  from_address_allowlist: FromAllowlistEntry[]
}

interface TestSendResponse {
  ok: true
  send: EmailSendRow
  recipient: string
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: ['admin', 'email-templates'] as const,
    queryFn: () => adminGet<ListResponse>('/email-templates'),
    staleTime: 60 * 1000,
  })
}

export function useEmailTemplate(key: string | null) {
  return useQuery({
    queryKey: ['admin', 'email-template', key] as const,
    queryFn: () => adminGet<DetailResponse>(`/email-templates/${key}`),
    staleTime: 30 * 1000,
    enabled: Boolean(key),
  })
}

export interface TemplatePatch {
  name?: string
  subject?: string
  body_markdown?: string
  from_email?: string
  from_name?: string
  reply_to?: string | null
  is_active?: boolean
  trigger_event?: string
  delay_hours?: number
}

export function useUpdateEmailTemplate(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: TemplatePatch) =>
      adminPatch<{ ok: true; template: EmailTemplateRow }>(`/email-templates/${key}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'email-template', key] })
      void qc.invalidateQueries({ queryKey: ['admin', 'email-templates'] })
    },
  })
}

export function useTestSendEmailTemplate(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (overrides?: { first_name?: string }) =>
      adminPost<TestSendResponse>(`/email-templates/${key}/test-send`, overrides ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'email-template', key] })
    },
  })
}
