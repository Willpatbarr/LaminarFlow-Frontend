import { render, waitFor } from '@solidjs/testing-library'
import type { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'

import { anchorOfSelection } from './anchor'
import { cpSlice } from './offsets'

// The selection -> stored Markdown offsets, with a real TipTap editor in jsdom.

async function mount(markdown: string) {
    let editor: Editor | undefined
    render(() => <MarkdownEditor label="Notes" value={markdown} onChange={() => {}} ref={(e) => (editor = e)} />)
    await waitFor(() => expect(editor).toBeDefined())
    return editor!
}

/** Selects the first occurrence of `words` in the rendered text. */
function select(editor: Editor, words: string) {
    let found = -1
    editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.isText && node.text!.includes(words)) found = pos + node.text!.indexOf(words)
        return found < 0
    })
    expect(found).toBeGreaterThanOrEqual(0)
    editor.commands.setTextSelection({ from: found, to: found + words.length })
}

async function quoted(markdown: string, words: string) {
    const editor = await mount(markdown)
    const stored = editor.getMarkdown().trimEnd()
    select(editor, words)
    const anchor = anchorOfSelection(editor, stored)
    return { anchor, stored }
}

describe('anchorOfSelection', () => {
    it('is not ok with nothing selected', async () => {
        const editor = await mount('hello')
        expect(anchorOfSelection(editor, 'hello').ok).toBe(false)
    })

    it('maps plain text', async () => {
        const { anchor, stored } = await quoted('Ship it on Friday.', 'on Friday')
        expect(anchor).toMatchObject({ ok: true, start: 8, end: 17, text: 'on Friday' })
        expect(cpSlice(stored, 8, 17)).toBe('on Friday')
    })

    it('counts the markup before the selection: heading, bold and link syntax', async () => {
        const markdown = '# Plan\n\nFirst **bold move** then [the doc](lf://document/abc) and done.'
        const { anchor, stored } = await quoted(markdown, 'and done')
        expect(anchor.ok).toBe(true)
        if (anchor.ok) expect(cpSlice(stored, anchor.start, anchor.end)).toBe('and done')
    })

    it('maps a selection inside bold to the words, not the markers', async () => {
        const { anchor, stored } = await quoted('Some **very important** words', 'important')
        expect(anchor.ok).toBe(true)
        if (anchor.ok) expect(cpSlice(stored, anchor.start, anchor.end)).toBe('important')
    })

    it('maps text in a later list item', async () => {
        const { anchor, stored } = await quoted('- one\n- two\n- three', 'three')
        expect(anchor.ok).toBe(true)
        if (anchor.ok) expect(cpSlice(stored, anchor.start, anchor.end)).toBe('three')
    })

    it('counts emoji as one character each, not two UTF-16 units', async () => {
        const markdown = 'Launch 🚀🚀 party 🎉 tonight, bring 😀 friends'
        const { anchor, stored } = await quoted(markdown, 'tonight')
        expect(anchor.ok).toBe(true)
        if (anchor.ok) {
            // "Launch 🚀🚀 party 🎉 " is 7 + 2 + 7 + 1 + 1 = 18 code points, 21 UTF-16 units.
            expect(anchor.start).toBe(18)
            expect(anchor.end).toBe(25)
            expect(cpSlice(stored, anchor.start, anchor.end)).toBe('tonight')
            expect(stored.indexOf('tonight')).toBe(21)
        }
    })

    it('can select an emoji itself', async () => {
        const { anchor, stored } = await quoted('a 😀 b', '😀')
        expect(anchor.ok).toBe(true)
        if (anchor.ok) {
            expect(anchor).toMatchObject({ start: 2, end: 3 })
            expect(cpSlice(stored, 2, 3)).toBe('😀')
        }
    })

    it('falls back to a unique match when the stored string is written differently', async () => {
        const editor = await mount('Ship it on Friday.')
        select(editor, 'Friday')
        // An API client stored an equivalent value in another style.
        const anchor = anchorOfSelection(editor, 'Ship  it on Friday.')
        expect(anchor).toMatchObject({ ok: true, start: 12, end: 18, text: 'Friday' })
    })

    it('refuses rather than guess when the fallback is ambiguous or absent', async () => {
        const editor = await mount('again and again')
        select(editor, 'again')
        expect(anchorOfSelection(editor, 'again  and again').ok).toBe(false)
        expect(anchorOfSelection(editor, 'something else').ok).toBe(false)
    })
})
