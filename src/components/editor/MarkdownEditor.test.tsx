import { render, screen, waitFor } from '@solidjs/testing-library'
import type { Editor } from '@tiptap/core'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from './MarkdownEditor'

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
