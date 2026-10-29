/*
┌─ review ────────────────────────────────────────
│  Unicode code point offsets, which is what the review request API counts
├─ out ───────────────────────────────────────────
│      cpLength(text)                  characters in text
│      cpSlice(text, start, end)       text between two code point offsets
│      cpOffsetOfIndex(text, index)    code point offset of a UTF-16 index
│      indexOfCpOffset(text, offset)   UTF-16 index of a code point offset
*/
// The backend (docs/review-requests.md) counts a character as one Unicode code
// point: 0-based, end-exclusive, into the stored Markdown string. JavaScript
// strings count UTF-16 units, so an emoji outside the Basic Multilingual Plane
// is two units here and one there. Every offset that crosses the wire goes
// through these four functions and never through `.length` or `.slice`.

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

export function cpLength(text: string): number {
    let count = 0
    for (let i = 0; i < text.length; i++) {
        if (isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) i++
        count++
    }
    return count
}

/** The code point offset of a UTF-16 index (an index inside a pair counts as before it). */
export function cpOffsetOfIndex(text: string, index: number): number {
    return cpLength(text.slice(0, Math.max(0, Math.min(index, text.length))))
}

/** The UTF-16 index of a code point offset; past the end gives the length. */
export function indexOfCpOffset(text: string, offset: number): number {
    let index = 0
    for (let seen = 0; seen < offset && index < text.length; seen++) {
        index += isHigh(text.charCodeAt(index)) && index + 1 < text.length && isLow(text.charCodeAt(index + 1)) ? 2 : 1
    }
    return index
}

export function cpSlice(text: string, start: number, end: number): string {
    const from = indexOfCpOffset(text, start)
    return text.slice(from, from + (indexOfCpOffset(text.slice(from), end - start)))
}
