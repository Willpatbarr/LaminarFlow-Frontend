import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { createEffect, createSignal, createUniqueId, onSettled, Show, untrack } from 'solid-js'

import { FieldFoot } from '../ui/CharacterCount'
import { describedBy, isOver, type Count } from '../ui/count'
import { editorLinks } from './internalLinks'
import { InternalLink, insertChipAt, LinkOrChip } from './internalLinkNode'
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
// they survive a round trip. They are drawn as chips (internalLinkNode.ts), and
// typing `[[` or `@` opens the app's picker when the shell has registered one
// (internalLinks.ts).

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
    /** Keeps the label for screen readers only: for an editor that sits under
     *  a heading of its own (a comment), where a visible label repeats it. */
    labelHidden?: boolean
    /** Marks the field invalid and renders the message under it. */
    error?: string
    /** A limit on the text, counted by the caller (see ui/count). Nothing is
     *  cut off: the count shows near the limit, and over it the field is
     *  marked invalid (say why with `error`). */
    count?: Count
    /** Receives the editor, for the caller to focus it or read its state. */
    ref?: (editor: Editor) => void
}

export function MarkdownEditor(props: MarkdownEditorProps) {
    const labelId = createUniqueId()
    const errorId = `${labelId}-error`
    const countId = `${labelId}-count`
    let element: HTMLDivElement | undefined
    let editor: Editor | undefined
    // The Markdown the editor last agreed on with the caller.
    let known = ''
    // Where in the text the picker was opened, while it is open.
    const [picking, setPicking] = createSignal<number | null>(null)

    onSettled(() => {
        if (!element) return
        known = props.value
        editor = new Editor({
            element,
            extensions: [
                StarterKit.configure({
                    // Markdown has no underline: it would not survive a save.
                    underline: false,
                    link: false,
                }),
                LinkOrChip.configure({ openOnClick: false, protocols: LINK_PROTOCOLS, autolink: true }),
                Markdown,
                InternalLink.configure({ onPicker: setPicking }),
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
        applyState()
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

    // ProseMirror owns the editable element, so what it should say about the
    // field's state is set on it directly: when it changes, and once the editor
    // exists (the first run of the effect can come before it does).
    let shown = { invalid: false, readOnly: false, described: undefined as string | undefined }
    function applyState() {
        const dom = editor?.view.dom
        if (!dom) return
        const set = (name: string, value: string | undefined) =>
            value === undefined ? dom.removeAttribute(name) : dom.setAttribute(name, value)
        set('aria-invalid', shown.invalid ? 'true' : undefined)
        set('aria-readonly', shown.readOnly ? 'true' : undefined)
        set('aria-describedby', shown.described)
    }
    createEffect(
        () => ({
            invalid: Boolean(props.error) || isOver(props.count),
            readOnly: Boolean(props.readOnly),
            described: describedBy(props, errorId, countId),
        }),
        (state) => {
            shown = state
            applyState()
        },
    )

    return (
        <div class="md-editor" data-readonly={props.readOnly ? 'true' : undefined}>
            <span class="input__label t-body" data-hidden={props.labelHidden ? 'true' : undefined} id={labelId}>
                {props.label}
            </span>
            <div class="md-editor__box" ref={(el) => {
                    element = el
                }}
            />
            <Show when={picking() !== null}>
                {editorLinks()?.picker({
                    onPick: (target) => {
                        const at = picking()
                        setPicking(null)
                        if (editor && at !== null) insertChipAt(editor, at, target, target.title)
                    },
                    onClose: () => {
                        setPicking(null)
                        editor?.commands.focus()
                    },
                })}
            </Show>
            <FieldFoot errorId={errorId} countId={countId} error={props.error} count={props.count} />
        </div>
    )
}
