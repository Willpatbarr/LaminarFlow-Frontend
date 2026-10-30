import { humanSize } from './api'

/*
┌─ attachments ───────────────────────────────────────
│  the size limit, checked before an upload starts (LAM-159)
├─ out ───────────────────────────────────────────────
│      MAX_ATTACHMENT_BYTES   the server's per-file limit
│      oversizeMessage(file)  "report.pdf is 31 MB; the limit is 25 MB", or null when it fits
*/
// TODO: mirrors the backend's MAX_ATTACHMENT_BYTES default (25 MiB,
// internal/config/config.go). The server exposes the limit only in the 413
// `attachment_too_large` body (`limit_bytes`), not in any endpoint or config the
// frontend can read first. If an operator changes MAX_ATTACHMENT_BYTES this
// constant is wrong: a file between the two limits is then refused here
// (smaller) or by the server (larger), and the server's answer still wins.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** A size as the message shows it; two decimals only when the two would read the same. */
function sizes(bytes: number, limit: number): [string, string] {
    const a = humanSize(bytes)
    const b = humanSize(limit)
    if (a !== b) return [a, b]
    const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(2)} MB`
    return [mb(bytes), mb(limit)]
}

export function oversizeText(name: string, bytes: number, limit: number): string {
    const [size, max] = sizes(bytes, limit)
    return `${name} is ${size}; the limit is ${max}.`
}

export function oversizeMessage(file: File): string | null {
    return file.size > MAX_ATTACHMENT_BYTES ? oversizeText(file.name, file.size, MAX_ATTACHMENT_BYTES) : null
}
