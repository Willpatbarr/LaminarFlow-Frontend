import type { Editor } from '@tiptap/core'

import { cpLength, cpOffsetOfIndex, cpSlice } from './offsets'

/*
┌─ review ────────────────────────────────────────
│  anchorOfSelection: the selection in an editor as a range of its Markdown
├─ in ────────────────────────────────────────────
│      editor   the field's TipTap editor
│      stored   the field's Markdown exactly as the server holds it
├─ out ───────────────────────────────────────────
│      { ok: true, start, end, text }   code point offsets into `stored`
│      { ok: false, reason }            nothing selected, or no safe place for it
*/
// The editor's positions are ProseMirror positions: they count nodes and
// skip the Markdown markup (`**`, `# `, `[label](url)`), so they are NOT
// offsets into the stored string. The way across that does not guess:
//
//  1. Put two marker characters (private use, never in real text) into a copy
//     of the document at the selection's two ends.
//  2. Serialize the copy to Markdown, the same serializer that wrote the value.
//  3. Find the markers in the output; the text before each is its offset, and
//     removing them gives the Markdown the offsets belong to.
//
// That is exact when the serialized copy equals `stored`, which it does for
// anything the editor wrote. If it does not (a value an API client wrote with a
// different style, say), the selected text is looked for in `stored` instead,
// and only a match that is unique is accepted: a wrong offset would be saved
// silently, so "no safe place" is the answer when it cannot be told.
const START = ''
const END = ''

export type Anchor = { ok: true; start: number; end: number; text: string } | { ok: false; reason: string }

const TRAILING = (text: string) => text.trimEnd()

export function anchorOfSelection(editor: Editor, stored: string): Anchor {
    const { from, to, empty } = editor.state.selection
    if (empty) return { ok: false, reason: 'Select some text first.' }

    const tr = editor.state.tr
    // End first, so inserting the start does not move it.
    tr.insertText(END, to)
    tr.insertText(START, from)
    const marked = (editor as unknown as { markdown?: { serialize(json: unknown): string } }).markdown?.serialize(tr.doc.toJSON())
    if (typeof marked !== 'string') return { ok: false, reason: 'This text cannot be marked right now.' }

    const startAt = marked.indexOf(START)
    const endAt = marked.indexOf(END)
    if (startAt < 0 || endAt < startAt) return { ok: false, reason: 'This selection cannot be placed in the text.' }

    const clean = TRAILING(marked.replace(START, '').replace(END, ''))
    const start = cpOffsetOfIndex(marked, startAt)
    const end = cpOffsetOfIndex(marked, endAt) - 1 // the start marker came before it
    const fits = start >= 0 && end >= start && end <= cpLength(clean)

    if (fits && clean === TRAILING(stored)) {
        return { ok: true, start, end, text: cpSlice(clean, start, end) }
    }

    // The fallback: the selected words, found in the stored string.
    const wanted = editor.state.doc.textBetween(from, to, '\n')
    const first = stored.indexOf(wanted)
    if (wanted.trim() === '' || first < 0 || stored.indexOf(wanted, first + 1) >= 0) {
        return { ok: false, reason: "That selection can't be placed exactly. Try selecting plain text within one paragraph." }
    }
    const s = cpOffsetOfIndex(stored, first)
    return { ok: true, start: s, end: s + cpLength(wanted), text: wanted }
}

/** The stored text a request points at now, for comparing with its quote. */
export function textAt(stored: string, start: number, end: number): string {
    return cpSlice(stored, start, end)
}
