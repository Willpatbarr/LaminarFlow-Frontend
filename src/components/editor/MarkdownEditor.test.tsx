import { render, screen, waitFor } from '@solidjs/testing-library'
import type { Editor } from '@tiptap/core'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from './MarkdownEditor'
import type { ImageUpload } from './images'
import { setEditorLinks, titlesChanged, type LinkTarget } from './internalLinks'

// The editor mounted for real in jsdom: Markdown in, Markdown out.

async function mount(value: string, extra: { onChange?: (md: string) => void } = {}) {
    let editor: Editor | undefined
    const onChange = extra.onChange ?? (() => {})
    render(() => (
        <MarkdownEditor label="Notes" value={value} onChange={onChange} ref={(e) => (editor = e)} />
    ))
    await waitFor(() => expect(editor).toBeDefined())
    return editor!
}

describe('MarkdownEditor', () => {
    it('is a labelled textbox', async () => {
        await mount('hello')
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent('hello')
    })

    it('renders Markdown it is given', async () => {
        const editor = await mount('# Title\n\n- one\n- two\n\n**bold** text')
        expect(editor.getHTML()).toContain('<h1>Title</h1>')
        expect(editor.getHTML()).toContain('<li>')
        expect(editor.getHTML()).toContain('<strong>bold</strong>')
    })

    it('reports Markdown on every edit', async () => {
        const onChange = vi.fn()
        const editor = await mount('', { onChange })
        editor.chain().focus().toggleHeading({ level: 2 }).insertContent('Heading').run()
        expect(onChange).toHaveBeenLastCalledWith('## Heading')
    })

    it('renders pasted Markdown', async () => {
        const editor = await mount('')
        editor.commands.insertContent('## Pasted\n\n1. a\n2. b', { contentType: 'markdown' } as never)
        expect(editor.getHTML()).toContain('<h2>Pasted</h2>')
        expect(editor.getHTML()).toContain('<ol>')
    })

    it.each([
        '[ticket](lf://ticket/3f2a1b4c-0000-4000-8000-000000000001)',
        'See [the doc](lf://document/abc-123) and [a project](lf://project/p-9) now.',
        'An [outside link](https://example.com/x) too.',
    ])('keeps links through a round trip: %s', async (markdown) => {
        const editor = await mount(markdown)
        expect(editor.getMarkdown().trim()).toBe(markdown)
    })

    it('round-trips headings, lists, quotes and code', async () => {
        const markdown = '# H\n\n- a\n- b\n\n> quote\n\n```\ncode\n```\n\n*em* and **strong** and ~~gone~~'
        const editor = await mount(markdown)
        expect(editor.getMarkdown().trim()).toBe(markdown.replace('*em*', '*em*'))
    })

    it('takes a new value from outside, and ignores its own echo', async () => {
        const [value, setValue] = createSignal('first')
        let editor: Editor | undefined
        const onChange = vi.fn()
        render(() => (
            <MarkdownEditor label="Notes" value={value()} onChange={onChange} ref={(e) => (editor = e)} />
        ))
        await waitFor(() => expect(editor).toBeDefined())
        setValue('second')
        await waitFor(() => expect(editor!.getMarkdown().trim()).toBe('second'))
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not let a read-only editor be edited', async () => {
        let editor: Editor | undefined
        render(() => <MarkdownEditor label="Notes" value="x" onChange={() => {}} readOnly ref={(e) => (editor = e)} />)
        await waitFor(() => expect(editor).toBeDefined())
        expect(editor!.isEditable).toBe(false)
    })

    it('runs several editors on one page without sharing anything', async () => {
        const seen: string[] = []
        render(() => (
            <>
                <MarkdownEditor label="One" value="a" onChange={(md) => seen.push(`one:${md}`)} />
                <MarkdownEditor label="Two" value="b" onChange={(md) => seen.push(`two:${md}`)} />
            </>
        ))
        await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(2))
        expect(screen.getByRole('textbox', { name: 'One' })).toHaveTextContent('a')
        expect(screen.getByRole('textbox', { name: 'Two' })).toHaveTextContent('b')
    })
})

describe('MarkdownEditor limits and state', () => {
    it('marks the field invalid with the message and the count when over its limit', async () => {
        render(() => (
            <MarkdownEditor
                label="Notes"
                value="hello"
                onChange={() => {}}
                count={{ used: 12, max: 10 }}
                error="Notes can be at most 10 characters."
            />
        ))
        const box = await screen.findByRole('textbox', { name: 'Notes' })
        await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'))
        expect(box).toHaveAccessibleDescription('Notes can be at most 10 characters. 12 / 10')
    })

    it('is not invalid inside its limit, and says when it is read-only', async () => {
        const [readOnly, setReadOnly] = createSignal(false)
        render(() => (
            <MarkdownEditor label="Notes" value="hello" onChange={() => {}} count={{ used: 3, max: 10 }} readOnly={readOnly()} />
        ))
        const box = await screen.findByRole('textbox', { name: 'Notes' })
        expect(box).not.toHaveAttribute('aria-invalid')
        expect(box).not.toHaveAttribute('aria-readonly')
        setReadOnly(true)
        await waitFor(() => expect(box).toHaveAttribute('aria-readonly', 'true'))
    })
})


describe('internal links as chips', () => {
    const titles: Record<string, string> = { 'document/d-1': 'Launch runbook' }
    const open = vi.fn()
    const targets: LinkTarget[] = [
        { kind: 'document', id: 'd-1', title: 'Launch runbook' },
        { kind: 'ticket', id: 't-1', title: 'Launch checklist' },
        { kind: 'project', id: 'p-1', title: 'Atlas' },
    ]
    function register() {
        setEditorLinks({ titleOf: (ref) => titles[`${ref.kind}/${ref.id}`], open, targets: () => targets })
    }

    it('draws an lf link as a chip with the target\'s current title, and stores it unchanged', async () => {
        register()
        const markdown = 'See [old name](lf://document/d-1) and [x](https://example.com/a).'
        const editor = await mount(markdown)
        const chip = screen.getByRole('link', { name: 'Launch runbook' })
        expect(chip).toHaveAttribute('href', '/documents/d-1')
        expect(chip).toHaveClass('lf-chip')
        // External links stay ordinary links.
        expect(screen.getByRole('link', { name: 'x' })).toHaveAttribute('href', 'https://example.com/a')
        expect(editor.getMarkdown().trim()).toBe(markdown)
        setEditorLinks(null)
    })

    it('shows the written label while the target is not in the store, and follows a rename', async () => {
        register()
        await mount('[Plan](lf://ticket/t-1)')
        expect(screen.getByRole('link', { name: 'Plan' })).toBeInTheDocument()
        titles['ticket/t-1'] = 'Plan v2'
        titlesChanged()
        expect(screen.getByRole('link', { name: 'Plan v2' })).toBeInTheDocument()
        delete titles['ticket/t-1']
        setEditorLinks(null)
    })

    it('goes to the target in the app when the chip is clicked', async () => {
        register()
        await mount('[Plan](lf://project/p-1)')
        screen.getByRole('link', { name: 'Plan' }).click()
        expect(open).toHaveBeenCalledWith('/projects/p-1')
        setEditorLinks(null)
    })

    it('escapes brackets in a label', async () => {
        const editor = await mount('')
        editor.commands.insertContent({ type: 'internalLink', attrs: { kind: 'ticket', id: 't', label: 'a [b] c' } })
        expect(editor.getMarkdown().trim()).toBe('[a \\[b\\] c](lf://ticket/t)')
    })

    // Text goes in as a transaction and keys as real keydown events on the field,
    // which is what ProseMirror (and so the suggestion) listens to.
    const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
        editor.view.dom.dispatchEvent(event)
        return event.defaultPrevented
    }
    const typeText = (editor: Editor, text: string) => editor.view.dispatch(editor.state.tr.insertText(text))
    const options = () => screen.queryAllByRole('option').map((o) => o.textContent)

    it('opens a listbox at the caret on @ at the start of a word and keeps focus in the editor', async () => {
        register()
        const editor = await mount('')
        editor.view.dom.focus()
        typeText(editor, 'a@b')
        expect(screen.queryByRole('listbox')).toBeNull()
        typeText(editor, ' @')
        const list = await screen.findByRole('listbox', { name: 'Link to a ticket, document or project' })
        expect(screen.getAllByRole('option')).toHaveLength(3)
        expect(screen.queryByRole('dialog')).toBeNull()
        const box = screen.getByRole('textbox', { name: 'Notes' })
        expect(box).toHaveFocus()
        expect(box).toHaveAttribute('aria-controls', list.id)
        // The top result is highlighted by default.
        const first = screen.getAllByRole('option')[0]
        expect(first).toHaveAttribute('aria-selected', 'true')
        expect(box).toHaveAttribute('aria-activedescendant', first.id)
        setEditorLinks(null)
    })

    it('filters as you type, and shows a row when nothing matches', async () => {
        register()
        const editor = await mount('')
        editor.commands.focus()
        typeText(editor, '@')
        await screen.findByRole('listbox')
        typeText(editor, 'launch')
        await waitFor(() => expect(options()).toHaveLength(2))
        // A space does not end the query: titles have spaces.
        typeText(editor, ' chec')
        await waitFor(() => expect(options()).toEqual(['Launch checklistTicket']))
        editor.commands.clearContent()
        typeText(editor, '@zzz')
        await waitFor(() => expect(options()).toEqual(['No tickets, documents or projects match']))
        expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true')
        // With nothing to pick, Enter is the editor's own.
        press(editor, 'Enter')
        expect(editor.state.doc.childCount).toBe(2)
        setEditorLinks(null)
    })

    it('moves the highlight with the arrows, wrapping, and picks with Enter', async () => {
        register()
        const onChange = vi.fn()
        const editor = await mount('Ask ', { onChange })
        editor.view.dom.focus()
        editor.commands.focus('end')
        typeText(editor, '@launch')
        await waitFor(() => expect(options()).toHaveLength(2))
        const selected = () => screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true')
        expect(selected()).toBe(0)
        expect(press(editor, 'ArrowDown')).toBe(true)
        await waitFor(() => expect(selected()).toBe(1))
        press(editor, 'ArrowDown')
        await waitFor(() => expect(selected()).toBe(0))
        press(editor, 'ArrowUp')
        await waitFor(() => expect(selected()).toBe(1))
        expect(press(editor, 'Enter')).toBe(true)
        await waitFor(() => expect(screen.getByRole('link', { name: 'Launch checklist' })).toBeInTheDocument())
        expect(screen.queryByRole('listbox')).toBeNull()
        // The trigger and the query are replaced, not left behind.
        expect(editor.getMarkdown().trim()).toBe('Ask [Launch checklist](lf://ticket/t-1)')
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus()
        setEditorLinks(null)
    })

    it('picks the top result with Tab, and a click picks that option', async () => {
        register()
        const editor = await mount('')
        editor.commands.focus()
        typeText(editor, '@')
        await screen.findByRole('listbox')
        expect(press(editor, 'Tab')).toBe(true)
        await waitFor(() => expect(screen.getByRole('link', { name: 'Launch runbook' })).toBeInTheDocument())
        typeText(editor, '@at')
        const atlas = await screen.findByRole('option', { name: /Atlas/ })
        atlas.click()
        await waitFor(() => expect(screen.getByRole('link', { name: 'Atlas' })).toBeInTheDocument())
        expect(editor.getMarkdown().trim()).toBe('[Launch runbook](lf://document/d-1) [Atlas](lf://project/p-1)')
        setEditorLinks(null)
    })

    it('closes on Escape and leaves what was typed', async () => {
        register()
        const editor = await mount('')
        editor.commands.focus()
        typeText(editor, '@lau')
        await screen.findByRole('listbox')
        expect(press(editor, 'Escape')).toBe(true)
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        expect(editor.getText()).toBe('@lau')
        expect(screen.getByRole('textbox', { name: 'Notes' })).not.toHaveAttribute('aria-controls')
        setEditorLinks(null)
    })

    it('opens on [[ anywhere and replaces the brackets and query on pick', async () => {
        register()
        const editor = await mount('')
        editor.commands.focus()
        typeText(editor, 'See[[atl')
        await waitFor(() => expect(options()).toHaveLength(1))
        press(editor, 'Enter')
        await waitFor(() => expect(screen.getByRole('link', { name: 'Atlas' })).toBeInTheDocument())
        expect(editor.getMarkdown().trim()).toBe('See[Atlas](lf://project/p-1)')
        setEditorLinks(null)
    })

    it('closes when the text turns into prose and leaves it as plain text', async () => {
        register()
        const editor = await mount('')
        editor.view.dom.focus()
        // (a) a space with nothing matching
        typeText(editor, '@zzz ')
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        typeText(editor, ' ')
        // (a) the query starting with a space, (b) two spaces in a row
        editor.commands.clearContent()
        typeText(editor, '@launch  ')
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        // (b) a newline
        editor.commands.clearContent()
        typeText(editor, '@launch')
        await screen.findByRole('listbox')
        editor.commands.splitBlock()
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        // (c) past 40 characters
        editor.commands.clearContent()
        typeText(editor, `@${'a'.repeat(41)}`)
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        expect(editor.getMarkdown()).not.toContain('lf://')
        setEditorLinks(null)
    })

    it('closes when the caret leaves the trigger', async () => {
        register()
        const editor = await mount('before ')
        editor.view.dom.focus()
        editor.commands.focus('end')
        typeText(editor, '@lau')
        await screen.findByRole('listbox')
        editor.commands.setTextSelection(2)
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        expect(editor.getText()).toContain('@lau')
        setEditorLinks(null)
    })

    it('"meet @ noon" then Enter is a newline, with no link', async () => {
        register()
        const editor = await mount('')
        editor.view.dom.focus()
        typeText(editor, 'meet @')
        await screen.findByRole('listbox')
        typeText(editor, ' noon')
        await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
        press(editor, 'Enter')
        expect(editor.state.doc.childCount).toBe(2)
        expect(editor.getMarkdown()).not.toContain('lf://')
        expect(editor.getText()).toContain('meet @ noon')
        setEditorLinks(null)
    })

    it('leaves Enter and the arrows alone when no list is open, and when the app registered nothing', async () => {
        const editor = await mount('')
        editor.commands.focus()
        typeText(editor, '@')
        expect(screen.queryByRole('listbox')).toBeNull()
        expect(press(editor, 'ArrowDown')).toBe(false)
        expect(editor.getText()).toBe('@')
    })

    it('turns a pasted internal URL into a chip and leaves other URLs alone', async () => {
        register()
        const editor = await mount('')
        editor.commands.focus()
        const paste = (text: string) => {
            const event = new Event('paste', { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : ''), types: ['text/plain'] } })
            editor.view.dom.dispatchEvent(event)
            return event.defaultPrevented
        }
        expect(paste(`${location.origin}/documents/d-1`)).toBe(true)
        expect(editor.getMarkdown().trim()).toBe('[Launch runbook](lf://document/d-1)')
        paste('https://example.com/documents/d-1')
        expect(editor.getMarkdown()).toContain('https://example.com/documents/d-1')
        expect(editor.getMarkdown().match(/lf:\/\//g)).toHaveLength(1)
        setEditorLinks(null)
    })
})

describe('images (LAM-116)', () => {
    const url = '/api/v1/attachments/0b7d4a3e-6d5f-4c1e-9a53-2f8d6b1e4712'

    it('draws an attachment image and keeps its Markdown', async () => {
        const markdown = `![a cat](${url})`
        const editor = await mount(markdown)
        expect(document.querySelector(`img[src="${url}"]`)).not.toBeNull()
        expect(editor.getMarkdown().trim()).toBe(markdown)
    })

    it('does not fetch an image from anywhere else, and keeps its Markdown', async () => {
        const markdown = '![pixel](https://evil.example/p.png)'
        const editor = await mount(markdown)
        expect(document.querySelector('img')).toBeNull()
        expect(document.body).toHaveTextContent('Image not shown')
        expect(editor.getMarkdown().trim()).toBe(markdown)
    })

    function mountWithImages(images: ImageUpload) {
        let editor: Editor | undefined
        const onChange = vi.fn()
        render(() => (
            <MarkdownEditor label="Notes" value="" onChange={onChange} images={images} ref={(e) => (editor = e)} />
        ))
        return { onChange, editor: () => editor! }
    }

    function pasteFile(file: File) {
        const target = screen.getByRole('textbox', { name: 'Notes' })
        const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
        event.clipboardData = { files: [file], types: ['Files'], getData: () => '' }
        target.dispatchEvent(event)
        return event
    }

    it('uploads a pasted image, shows progress, then inserts the Markdown image', async () => {
        let finish: (r: { ok: true; url: string; alt: string }) => void = () => {}
        const upload = vi.fn(
            (_file: File, onProgress: (f: number) => void) =>
                new Promise<{ ok: true; url: string; alt: string }>((resolve) => {
                    onProgress(0.5)
                    finish = resolve
                }),
        )
        const { onChange, editor } = mountWithImages(upload)
        await waitFor(() => expect(editor()).toBeDefined())
        const event = pasteFile(new File(['x'], 'shot.png', { type: 'image/png' }))
        expect(event.defaultPrevented).toBe(true)
        expect(upload).toHaveBeenCalledTimes(1)
        expect(await screen.findByText('Uploading shot.png')).toBeInTheDocument()
        expect(screen.getByRole('progressbar', { name: 'Uploading shot.png' })).toHaveValue(0.5)
        finish({ ok: true, url, alt: 'shot' })
        await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(`![shot](${url})`))
        expect(screen.queryByText('Uploading shot.png')).toBeNull()
    })

    it('shows why an upload failed and inserts nothing', async () => {
        const upload = vi.fn(async () => ({ ok: false as const, message: 'shot.png is too large. Files can be at most 25 MB.' }))
        const { onChange, editor } = mountWithImages(upload)
        await waitFor(() => expect(editor()).toBeDefined())
        pasteFile(new File(['x'], 'shot.png', { type: 'image/png' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('at most 25 MB')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves a paste of text alone', async () => {
        const upload = vi.fn()
        const { editor } = mountWithImages(upload)
        await waitFor(() => expect(editor()).toBeDefined())
        const target = screen.getByRole('textbox', { name: 'Notes' })
        const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
        event.clipboardData = { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? 'hello' : '') }
        target.dispatchEvent(event)
        expect(upload).not.toHaveBeenCalled()
    })
})
