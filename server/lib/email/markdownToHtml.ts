/**
 * Minimal Markdown → HTML renderer scoped to the subset our lifecycle
 * emails actually use. Why not pull in `marked` or `markdown-it`:
 * those libraries are ~30-80 KB, surface a wide API the admin
 * couldn't accidentally abuse safely, and the email format is fixed.
 *
 * Supported:
 *   - Paragraphs (blank line separator)
 *   - Hard line breaks (single newline → <br>)
 *   - Links: [text](url) — URLs whitelisted to http(s)/mailto only
 *   - Bold: **text** → <strong>
 *   - Italic: *text* → <em> (greedy match avoids tripping on lists)
 *   - Bullets: lines starting "- " → <ul><li>…</li></ul>
 *   - Headings: leading # / ## / ### / #### → h1..h4
 *   - Em-dashes (—) and arrows (→) pass through verbatim
 *   - HTML entities escaped before formatting so a "<" in copy
 *     never becomes a tag
 *
 * NOT supported: tables, images, code blocks, raw HTML, footnotes.
 * Admin paste-attacks via these markers no-op.
 */

const MAX_URL_LENGTH = 2048

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(raw: string): string | null {
  if (!raw || raw.length > MAX_URL_LENGTH) return null
  const trimmed = raw.trim()
  // Allow only http, https, and mailto schemes. Block javascript:,
  // data:, file:, etc.
  if (!/^(https?:|mailto:)/i.test(trimmed)) return null
  return trimmed
}

function renderInline(line: string): string {
  let s = escapeHtml(line)
  // Links: [text](url). URL re-decoded so the safeUrl check sees
  // raw scheme.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) => {
    const decoded = url
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    const safe = safeUrl(decoded)
    if (!safe) return text
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })
  // Bold first (greedier match wins): **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Italic: *text* — avoid matching across boundaries created by
  // bold; the prior replace removed all matched **…**.
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  return s
}

function isHeading(line: string): { level: 1 | 2 | 3 | 4; text: string } | null {
  const m = /^(#{1,4})\s+(.*)$/.exec(line)
  if (!m) return null
  const hashes = m[1]!
  return { level: hashes.length as 1 | 2 | 3 | 4, text: m[2]! }
}

function isBullet(line: string): string | null {
  const m = /^\s*-\s+(.*)$/.exec(line)
  return m ? m[1]! : null
}

export function markdownToHtml(md: string): string {
  if (!md) return ''
  // Normalise newlines so the paragraph-splitter is consistent across
  // copy/paste sources (which may use \r\n).
  const normalised = md.replace(/\r\n/g, '\n')
  // Split on blank lines — each block becomes a <p>, <ul>, or <hX>.
  const blocks = normalised.split(/\n\s*\n/)
  const out: string[] = []
  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block) continue
    const lines = block.split('\n')
    const firstLine = lines[0]!

    // Heading: single-line block starting with # marks.
    if (lines.length === 1) {
      const h = isHeading(firstLine)
      if (h) {
        out.push(`<h${h.level}>${renderInline(h.text)}</h${h.level}>`)
        continue
      }
    }

    // Bullet list: every line in the block matches "- …".
    if (lines.every((l) => isBullet(l) !== null)) {
      const items = lines.map((l) => `<li>${renderInline(isBullet(l)!)}</li>`).join('')
      out.push(`<ul>${items}</ul>`)
      continue
    }

    // Paragraph — join lines with <br> for soft line breaks.
    const inlined = lines.map(renderInline).join('<br>')
    out.push(`<p>${inlined}</p>`)
  }
  return out.join('\n')
}

/**
 * Wraps the rendered HTML in a minimal email-safe shell. Keeps the
 * stylesheet inline (mail clients strip <style> in <head> aggressively),
 * uses a max-width to look reasonable in desktop clients, and falls
 * back to system fonts so the founder voice still feels human even
 * without web fonts.
 */
export function wrapInEmailShell(html: string, title: string): string {
  const safeTitle = escapeHtml(title)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;">
<tr>
<td style="padding:32px 32px 8px 32px;">
${html}
</td>
</tr>
<tr>
<td style="padding:16px 32px 32px 32px;border-top:1px solid #f3f4f6;font-size:12px;color:#6b7280;">
You're receiving this because you signed up for Tago at tagorides.com. Reply to this email and we'll see it.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}
