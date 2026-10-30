import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from 'solid-js'

import { FieldFoot } from '../ui/CharacterCount'
import { describedBy, isOver, type Count } from '../ui/count'
import { AttachmentImage, ImageFiles, type ImageUpload } from './images'
import { editorLinks } from './internalLinks'
import { InternalLink, LinkOrChip } from './internalLinkNode'
import { keyAction, LinkSuggest, matchTargets, type Session } from './linkSuggest'
import { LinkSuggestList, optionId } from './LinkSuggestList'
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
// typing `[[` or `@` opens a list of what can be linked at the caret when the
// shell has registered it (internalLinks.ts, linkSuggest.ts). Focus stays in
// the editor: the field names the highlighted option with aria-activedescendant.

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
    /** Turns a pasted or dropped image into a URL (LAM-116). Absent: the editor
     *  takes no files. The editor shows the progress and the failure itself,
     *  under the field, and inserts the Markdown image when the upload is done. */
    images?: ImageUpload
    /** Cmd/Ctrl+Enter, to post or save what is written. Plain Enter stays a
     *  new line. While the link list has options it owns the keys, so the
     *  chord does nothing then: one key press is never a pick and a post. */
    onSubmit?: () => void
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
    // The open link list, if any, and which option is highlighted.
    const [session, setSession] = createSignal<Session | null>(null)
    const [active, setActive] = createSignal(0)
    const listId = `${labelId}-links`
    const links = () => (session() ? editorLinks() : null)
    const matches = createMemo(() => {
        const open = session()
        const all = open ? (editorLinks()?.targets() ?? []) : []
        return { shown: matchTargets(all, open?.query ?? ''), total: matchTargets(all, open?.query ?? '', Infinity).length }
    })
    const listed = () => matches().shown
    // The top result is the one to beat: a new query starts over at it.
    const query = createMemo(() => session()?.query)
    createEffect(query, () => {
        setActive(0)
    })
    // The caret has to stay visible: scroll the highlighted option into the list.
    createEffect(
        () => [active(), listed().length] as const,
        ([at]) => {
            document.getElementById(optionId(listId, at))?.scrollIntoView?.({ block: 'nearest' })
        },
    )

    function onLinkKey(event: KeyboardEvent) {
        const open = session()
        if (!open || !links()) return false
        const action = keyAction(event, active(), listed().length)
        if (action === 'none') return false
        if (action === 'pick') {
            // Only with a highlighted result: otherwise Enter and Tab are the editor's.
            const target = listed()[active()]
            if (!target) return false
            open.pick(target)
            return true
        }
        setActive(action.move)
        return true
    }
    // Images going up, and why the last one that failed did.
    const [uploads, setUploads] = createSignal<{ id: number; name: string; fraction: number }[]>([])
    const [uploadError, setUploadError] = createSignal('')
    let uploadSeq = 0

    // One file at a time, so they land in the order they were given.
    async function takeFiles(files: File[], at: number | null) {
        const upload = props.images
        setUploadError('')
        if (!upload) {
            setUploadError('Images cannot be added to this field.')
            return
        }
        const images = files.filter((file) => file.type.startsWith('image/'))
        if (images.length < files.length) {
            setUploadError('Only images can be dropped into the text. Use Attach a file to add other files.')
        }
        let position = at
        for (const file of images) {
            const id = ++uploadSeq
            setUploads((all) => [...all, { id, name: file.name, fraction: 0 }])
            const result = await upload(file, (fraction) =>
                setUploads((all) => all.map((u) => (u.id === id ? { ...u, fraction } : u))),
            )
            setUploads((all) => all.filter((u) => u.id !== id))
            if (!result.ok) {
                setUploadError(result.message)
                continue
            }
            if (!editor) return
            const end = editor.state.doc.content.size
            const target = Math.min(position ?? editor.state.selection.to, end)
            editor.chain().insertContentAt(target, { type: 'image', attrs: { src: result.url, alt: result.alt } }).run()
            // The next image goes after this one.
            position = null
        }
    }

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
                InternalLink,
                LinkSuggest.configure({ onSession: setSession, onKey: onLinkKey }),
                MarkdownPaste,
                AttachmentImage,
                ImageFiles.configure({ onFiles: (files, at) => void takeFiles(files, at) }),
                Placeholder.configure({ placeholder: props.placeholder ?? '' }),
            ],
            content: props.value,
            contentType: 'markdown',
            editable: !props.readOnly,
            editorProps: {
                handleKeyDown: (_view, event) => {
                    const chord = event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
                    if (!chord || event.isComposing || !props.onSubmit) return false
                    // Swallowed even when it does nothing, or the editor would add a line break.
                    if (!(session() && listed().length > 0) && !props.readOnly) untrack(() => props.onSubmit?.())
                    return true
                },
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

    // The editable element is ProseMirror's, so the list is tied to the field the
    // same way: it controls the list and names the highlighted option.
    createEffect(
        () => ({ open: links() !== null, at: active(), none: listed().length === 0 }),
        ({ open, at, none }) => {
            const dom = editor?.view.dom
            if (!dom) return
            if (!open) {
                for (const name of ['aria-controls', 'aria-activedescendant', 'aria-haspopup', 'aria-autocomplete']) dom.removeAttribute(name)
                return
            }
            dom.setAttribute('aria-haspopup', 'listbox')
            dom.setAttribute('aria-autocomplete', 'list')
            dom.setAttribute('aria-controls', listId)
            if (none) dom.removeAttribute('aria-activedescendant')
            else dom.setAttribute('aria-activedescendant', optionId(listId, at))
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
            <Show when={links() !== null && session()}>
                {(open) => (
                    <LinkSuggestList
                        id={listId}
                        options={listed()}
                        total={matches().total}
                        active={active()}
                        anchor={open().rect}
                        onActive={setActive}
                        onPick={open().pick}
                        onClose={open().dismiss}
                    />
                )}
            </Show>
            <Show when={uploads().length > 0}>
                <div class="md-editor__uploads t-meta" role="status">
                    <For each={uploads()} keyed={(u) => u.id}>
                        {(u) => (
                            <label class="md-editor__upload">
                                <span>Uploading {u().name}</span>
                                <progress max="1" value={u().fraction} aria-label={`Uploading ${u().name}`} />
                                <span>{Math.round(u().fraction * 100)}%</span>
                            </label>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={uploadError()}>
                <p class="md-editor__upload-error input__error t-meta" role="alert">
                    {uploadError()}
                </p>
            </Show>
            <FieldFoot errorId={errorId} countId={countId} error={props.error} count={props.count} />
        </div>
    )
}
