/*
┌─ search ────────────────────────────────────────
│  snippets and highlights as data, so nothing is ever set as HTML
├─ out ───────────────────────────────────────────
│      Piece                       { text, mark }: a run of text, marked or not
│      parseSnippet(snippet)       the server's escaped-with-<mark> string as pieces
│      highlight(text, words)      the same for plain text, marking each word
│      plain(pieces)               the pieces as one string
│      wordsOf(query)              the lower-cased words of a query
*/
// The server escapes the matched text and then puts <mark> round the matches.
// The only markup honoured here is <mark> and </mark>; every other `<` that
// arrives is text, so a snippet can never put an element on the page. The
// pieces are drawn as text nodes and <mark> elements.

export type Piece = { text: string; mark: boolean }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// The server escapes & < > " ' ; anything else is left alone, not guessed at.
function unescape(text: string): string {
    return text.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (whole, dec, hex, name) => {
        if (name) return ENTITIES[name.toLowerCase()]
        const code = dec ? Number(dec) : parseInt(hex, 16)
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
    })
}

export function parseSnippet(snippet: string): Piece[] {
    const pieces: Piece[] = []
    let marked = false
    for (const part of snippet.split(/(<\/?mark>)/)) {
        if (part === '<mark>') marked = true
        else if (part === '</mark>') marked = false
        else if (part !== '') pieces.push({ text: unescape(part), mark: marked })
    }
    return pieces
}

export const plain = (pieces: Piece[]) => pieces.map((p) => p.text).join('')

export const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

export function highlight(text: string, words: string[]): Piece[] {
    const lower = text.toLowerCase()
    const hit = new Array<boolean>(text.length).fill(false)
    // toLowerCase can change a string's length (a few letters); then the
    // positions do not line up and nothing is marked rather than the wrong text.
    if (lower.length === text.length) {
        for (const word of words) {
            for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) {
                hit.fill(true, at, at + word.length)
            }
        }
    }
    const pieces: Piece[] = []
    let start = 0
    for (let i = 1; i <= text.length; i++) {
        if (i === text.length || hit[i] !== hit[start]) {
            pieces.push({ text: text.slice(start, i), mark: hit[start] })
            start = i
        }
    }
    return text === '' ? [] : pieces
}
