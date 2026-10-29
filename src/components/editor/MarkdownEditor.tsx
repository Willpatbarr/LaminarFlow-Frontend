import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { createEffect, createUniqueId, onSettled, untrack } from 'solid-js'

import { MarkdownPaste } from './markdownPaste'
import './MarkdownEditor.css'

/*
┌─ components/editor ─────────────────────────────
│  a rich-text field whose value is a Markdown string (ADR 0006, LAM-88)
├─ out ───────────────────────────────────────────
│      MarkdownEditor   <MarkdownEditor label value onChange … />
│      LINK_PROTOCOLS   the URL schemes a link may carry (https, mailto, lf)
├─ example ───────────────────────────────────────
│      <MarkdownEditor label="Notes" value={body.notes ?? ''} onChange={save} />
*/
// Built to be used more than once on a page (an aspect document has one per
// field, LAM-109): every instance owns its TipTap Editor, mounted on its own
// element, and shares nothing with the others.
//
// The value goes in and out as Markdown and nothing else. Only what Markdown
// can say is offered (the StarterKit minus underline), because anything else
// would be lost the first time the value was saved. Internal links are plain
// links to `lf://ticket|document|project/<id>`; the `lf` scheme is allowed so
// they survive a round trip. Drawing them as chips is LAM-108.

/** Schemes a link may use. TipTap drops a link whose scheme it does not know,
 *  which would silently turn `lf://` links into plain text. */
export const LINK_PROTOCOLS = ['lf']

type MarkdownEditorProps = {
    /** The field's name, for screen readers and as the visible label. */
    label: string
    /** The Markdown held for this field. A new value that differs from what the
     *  editor last reported replaces its content; one that matches is ignored,
     *  so a save landing mid-word never moves the cursor. */
    value: string
    /** The new Markdown, on every edit. */
    onChange: (markdown: string) => void
    /** Focus left the editor. For a field that saves when you leave it. */
    onBlur?: () => void
    placeholder?: string
    /** Shows the text and lets it be selected, but not changed. */
    readOnly?: boolean
    /** Receives the editor, for the caller to focus it or read its state. */
    ref?: (editor: Editor) => void
}

export function MarkdownEditor(props: MarkdownEditorProps) {
    const labelId = createUniqueId()
    let element: HTMLDivElement | undefined
    let editor: Editor | undefined
    // The Markdown the editor last agreed on with the caller.
    let known = ''

    onSettled(() => {
        if (!element) return
        known = props.value
        editor = new Editor({
            element,
            extensions: [
                StarterKit.configure({
                    // Markdown has no underline: it would not survive a save.
                    underline: false,
                    link: { openOnClick: false, protocols: LINK_PROTOCOLS, autolink: true },
                }),
                Markdown,
                MarkdownPaste,
                Placeholder.configure({ placeholder: props.placeholder ?? '' }),
            ],
            content: props.value,
            contentType: 'markdown',
            editable: !props.readOnly,
            editorProps: {
                attributes: {
                    role: 'textbox',
                    'aria-multiline': 'true',
                    'aria-labelledby': labelId,
                    class: 'md-editor__content t-body',
                },
            },
            onUpdate: ({ editor: changed }) => {
                // No trailing blank lines: they are not text, and would make every
                // value differ from the one a client wrote.
                known = changed.getMarkdown().trimEnd()
                // An event, not a tracking scope: the caller may read signals in it.
                untrack(() => props.onChange(known))
            },
            onBlur: () => untrack(() => props.onBlur?.()),
        })
        props.ref?.(editor)
        return () => {
            editor?.destroy()
            editor = undefined
        }
    })

    createEffect(
        () => props.value,
        (value) => {
            if (!editor || value === known) return
            known = value
            editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
        },
    )

    createEffect(
        () => !props.readOnly,
        (editable) => {
            // Not an edit: no update event, or the caller would be told of one.
            editor?.setEditable(editable, false)
        },
    )

    return (
        <div class="md-editor" data-readonly={props.readOnly ? 'true' : undefined}>
            <span class="input__label t-body" id={labelId}>
                {props.label}
            </span>
            <div class="md-editor__box" ref={(el) => {
                    element = el
                }}
            />
        </div>
    )
}
