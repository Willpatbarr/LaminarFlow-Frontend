import { describe, expect, it } from 'vitest'

import { highlight, parseSnippet, plain } from './snippet'

describe('parseSnippet', () => {
    it('marks only what is inside <mark>', () => {
        expect(parseSnippet('fix the <mark>outbox</mark> now')).toEqual([
            { text: 'fix the ', mark: false },
            { text: 'outbox', mark: true },
            { text: ' now', mark: false },
        ])
    })

    it('turns the server escapes back into text, and never into markup', () => {
        const pieces = parseSnippet('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;<mark>a&#39;b</mark>&quot;')
        expect(plain(pieces)).toBe('<img src=x onerror=alert(1)> & "a\'b"')
        expect(pieces.filter((p) => p.mark)).toEqual([{ text: "a'b", mark: true }])
    })

    it('treats any other tag as text', () => {
        expect(plain(parseSnippet('<b>bold</b> <mark>hit</mark>'))).toBe('<b>bold</b> hit')
    })

    it('leaves an unknown entity alone', () => {
        expect(plain(parseSnippet('&nbsp; &#0; &#xD800;'))).toBe('&nbsp; &#0; &#xD800;')
    })
})

describe('highlight', () => {
    it('marks every occurrence of every word, ignoring case', () => {
        expect(highlight('Write the Outbox, write more', ['write', 'outbox'])).toEqual([
            { text: 'Write', mark: true },
            { text: ' the ', mark: false },
            { text: 'Outbox', mark: true },
            { text: ', ', mark: false },
            { text: 'write', mark: true },
            { text: ' more', mark: false },
        ])
    })

    it('returns the whole text unmarked when nothing matches', () => {
        expect(highlight('Nothing', ['zz'])).toEqual([{ text: 'Nothing', mark: false }])
        expect(highlight('', ['a'])).toEqual([])
    })
})
