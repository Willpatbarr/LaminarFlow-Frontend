import { afterEach, describe, expect, it, vi } from 'vitest'

import { humanSize, uploadAttachment } from './api'

// The upload is an XMLHttpRequest (fetch cannot report progress), so it is
// tested against a stand-in that records what was sent.

class FakeXhr {
    static last: FakeXhr
    headers: Record<string, string> = {}
    method = ''
    url = ''
    body: FormData | undefined
    status = 0
    responseText = ''
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
    onload?: () => void
    onerror?: () => void
    onabort?: () => void
    ontimeout?: () => void
    withCredentials = false
    constructor() {
        FakeXhr.last = this
    }
    open(method: string, url: string) {
        this.method = method
        this.url = url
    }
    setRequestHeader(name: string, value: string) {
        this.headers[name] = value
    }
    send(body: FormData) {
        this.body = body
    }
    abort() {
        this.onabort?.()
    }
    answer(status: number, body: unknown) {
        this.status = status
        this.responseText = JSON.stringify(body)
        this.onload?.()
    }
}

afterEach(() => vi.unstubAllGlobals())

const png = () => new File([new Uint8Array([1, 2, 3])], 'cat.png', { type: 'image/png' })

describe('uploadAttachment', () => {
    it('sends the owner before the file, with an idempotency key, and reports progress', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        const progress = vi.fn()
        const done = uploadAttachment({ ticketId: 't-1' }, png(), { onProgress: progress })
        const xhr = FakeXhr.last
        expect(xhr.method).toBe('POST')
        expect(xhr.url).toBe('/api/v1/attachments')
        expect([...xhr.body!.keys()]).toEqual(['ticket_id', 'file'])
        expect(xhr.body!.get('ticket_id')).toBe('t-1')
        expect(xhr.headers['Idempotency-Key']).toMatch(/\S/)
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
        expect(progress).toHaveBeenLastCalledWith(0.25)
        xhr.answer(200, { id: 'a-1', url: '/api/v1/attachments/a-1', filename: 'cat.png' })
        expect(await done).toMatchObject({ ok: true, data: { id: 'a-1' } })
        expect(progress).toHaveBeenLastCalledWith(1)
    })

    it('uses document_id for a document', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        void uploadAttachment({ documentId: 'd-1' }, png())
        expect([...FakeXhr.last.body!.keys()]).toEqual(['document_id', 'file'])
    })

    it('names the limit on a 413', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        const done = uploadAttachment({ ticketId: 't-1' }, png())
        FakeXhr.last.answer(413, { code: 'attachment_too_large', limit_bytes: 26214400 })
        expect(await done).toMatchObject({ ok: false, code: 'attachment_too_large', limitBytes: 26214400 })
        expect((await done) as { message: string }).toHaveProperty('message', 'cat.png is over the limit of 25 MB.')
    })

    it('refuses an oversize file before sending anything', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        FakeXhr.last = undefined as never
        const progress = vi.fn()
        const big = new File(['x'], 'report.pdf', { type: 'application/pdf' })
        Object.defineProperty(big, 'size', { value: 31 * 1024 * 1024 })
        const result = await uploadAttachment({ ticketId: 't-1' }, big, { onProgress: progress })
        expect(result).toMatchObject({
            ok: false,
            code: 'attachment_too_large',
            message: 'report.pdf is 31 MB; the limit is 25 MB.',
        })
        expect(FakeXhr.last).toBeUndefined()
        expect(progress).not.toHaveBeenCalled()
    })

    it('says a refused type is refused', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        const done = uploadAttachment({ ticketId: 't-1' }, png())
        FakeXhr.last.answer(415, { code: 'attachment_type_not_allowed' })
        expect(await done).toMatchObject({ ok: false, code: 'attachment_type_not_allowed' })
    })

    it('reports no connection', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr)
        const done = uploadAttachment({ ticketId: 't-1' }, png())
        FakeXhr.last.onerror?.()
        expect(await done).toMatchObject({ ok: false, code: 'network' })
    })
})

describe('humanSize', () => {
    it.each([
        [12, '12 B'],
        [2048, '2 KB'],
        [26214400, '25 MB'],
        [1572864, '1.5 MB'],
    ])('%i is %s', (bytes, text) => {
        expect(humanSize(bytes)).toBe(text)
    })
})
