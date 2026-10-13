/*
┌─ auth ──────────────────────────────────────────
│  where to go after login, and nowhere else
├─ out ───────────────────────────────────────────
│      safeReturnTo   untrusted string → a same-origin path, or '/'
│      withReturnTo   '/login' + a destination → '/login?returnTo=…'
│      loginPathFor   a destination → the login URL that brings you back to it
├─ example ───────────────────────────────────────
│      '/tickets?x=1'          →  '/tickets?x=1'
│      'https://evil.example'  →  '/'
*/

// The login screens never count as a destination: coming back to one after
// signing in would leave the user on a form they have just finished with.
const AUTH_PATHS = new Set(['/login', '/signup'])

// Stands in for "this site" when parsing. Its only job is to be an origin we
// can compare against: whatever the input resolves to must still be it.
const BASE = 'http://returnto.invalid'

// `returnTo` arrives in the URL, so anyone can put anything there - including a
// link that sends someone to a look-alike login page after they have really
// signed in. Only a path on this site is allowed through; everything else
// becomes the home page, never an error, because the user did nothing wrong.
export function safeReturnTo(value: unknown): string {
    if (typeof value !== 'string') return '/'

    // One leading slash. `//host` and `/\host` are protocol-relative to a
    // browser (it treats `\` as `/`), and a scheme such as `javascript:` or
    // `https:` cannot start with a slash, so this also rules those out.
    if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'

    // Browsers delete tab, CR and LF anywhere in a URL, so `/<TAB>/host` is
    // `//host` by the time it is used. Control characters have no business in
    // a path anyway.
    // oxlint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return '/'

    // The check above is a pattern; this one is the definition. If the URL
    // parser does not agree the result is on our origin, believe the parser.
    let url: URL
    try {
        url = new URL(value, BASE)
    } catch {
        return '/'
    }
    if (url.origin !== BASE) return '/'

    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
    if (AUTH_PATHS.has(path)) return '/'

    return value
}

/** `path` with the destination attached, or bare `path` when the destination is
 *  just home (or not allowed), so the common URL stays `/login`. */
export function withReturnTo(path: '/login' | '/signup', destination: unknown): string {
    const safe = safeReturnTo(destination)
    return safe === '/' ? path : `${path}?${new URLSearchParams({ returnTo: safe })}`
}

export function loginPathFor(destination: unknown): string {
    return withReturnTo('/login', destination)
}
