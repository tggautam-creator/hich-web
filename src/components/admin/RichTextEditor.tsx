import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'

/**
 * Gmail-style rich text editor for the admin email composer (Slice 1.5).
 *
 * Wraps TipTap with a minimal toolbar (bold / italic / underline-via-
 * em / H2 / list / ordered list / link). Returns HTML to the parent
 * via `onChange` for serialization. Attachments + image insertion are
 * deferred to a Slice 1.5 follow-up — the email body can still
 * include images via an HTML <img src="..."> snippet for now.
 *
 * Why a custom wrapper instead of a third-party WYSIWYG: TipTap is
 * Tago-controllable (no external CSS to fight), serializes cleanly to
 * HTML, and the toolbar buttons are 3 lines each. The full Gmail
 * polish (toolbars, undo/redo affordance, slash menu) can layer on
 * top in Phase 2 without rewriting the editor itself.
 */
interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write your email…',
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[200px] max-h-[400px] overflow-y-auto rounded-b-md border-x border-b border-border bg-white px-3 py-2 text-sm text-text-primary focus:outline-none prose prose-sm max-w-none',
      },
    },
  })

  // 2026-05-19 — sync external `value` changes back into the editor.
  // TipTap's `useEditor` reads `content` only once on mount, so without
  // this hook, parent state changes (e.g. clicking Duplicate on a past
  // campaign which fires setBodyHtml(row.body)) NEVER propagate into
  // the editor surface — admin sees the body field stay empty even
  // though state is correct.
  //
  // Loop-safety: the `getHTML() !== value` guard means we only call
  // setContent when the external value DIFFERS from what the editor
  // already shows. After a user keystroke, `onUpdate` calls
  // `onChange(html)`, parent sets state to that exact html, this
  // effect re-runs but the guard says they're equal → no-op. So
  // typing doesn't trigger a setContent loop.
  //
  // `{ emitUpdate: false }` suppresses the `update` event that would
  // otherwise re-fire onUpdate → setBodyHtml → infinite loop.
  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() === value) return
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  if (!editor) return null

  return (
    <div data-testid="rich-text-editor" className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-1 rounded-t-md border-b border-border bg-surface px-2 py-1.5">
        <ToolbarButton
          label="B"
          bold
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          italic
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="S"
          strike
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <Separator />
        <ToolbarButton
          label="H1"
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          label="H2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="¶"
          active={editor.isActive('paragraph')}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <Separator />
        <ToolbarButton
          label="•"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="1."
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="❝"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <Separator />
        <ToolbarButton
          label="link"
          active={editor.isActive('link')}
          onClick={() => {
            const previous = editor.getAttributes('link')['href'] as string | undefined
            const url = window.prompt('URL', previous ?? 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }}
        />
        <ToolbarButton
          label="undo"
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="redo"
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton({
  label,
  active = false,
  bold = false,
  italic = false,
  strike = false,
  onClick,
}: {
  label: string
  active?: boolean
  bold?: boolean
  italic?: boolean
  strike?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded px-2 py-0.5 text-xs transition-colors',
        active
          ? 'bg-primary-light text-primary'
          : 'text-text-secondary hover:bg-white hover:text-text-primary',
        bold && 'font-bold',
        italic && 'italic',
        strike && 'line-through',
      ].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  )
}

function Separator() {
  return <span className="h-4 w-px bg-border mx-0.5" aria-hidden />
}
