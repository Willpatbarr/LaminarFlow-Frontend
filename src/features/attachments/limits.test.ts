import { describe, expect, it } from 'vitest'

import { imageUploader } from './upload'
import { MAX_ATTACHMENT_BYTES, oversizeMessage, oversizeText } from './limits'

const fileOf = (name: string, size: number) => {
    const file = new File(['x'], name)
    Object.defineProperty(file, 'size', { value: size })
    return file
}

describe('oversizeMessage', () => {
    it('lets a file at the limit through', () => {
        expect(oversizeMessage(fileOf('ok.bin', MAX_ATTACHMENT_BYTES))).toBeNull()
    })

    it('names the file, its size and the limit', () => {
        expect(oversizeMessage(fileOf('report.pdf', 31 * 1024 * 1024))).toBe('report.pdf is 31 MB; the limit is 25 MB.')
    })

    it('uses two decimals when the sizes would otherwise read the same', () => {
        expect(oversizeText('a.bin', MAX_ATTACHMENT_BYTES + 100_000, MAX_ATTACHMENT_BYTES)).toBe(
            'a.bin is 25.10 MB; the limit is 25.00 MB.',
        )
    })
})

describe('imageUploader', () => {
    it('refuses an oversize image without waiting for the parent or uploading', async () => {
        const result = await imageUploader(() => ({ ticketId: 't-1' }))(fileOf('big.png', 40 * 1024 * 1024), () => {})
        expect(result).toEqual({ ok: false, message: 'big.png is 40 MB; the limit is 25 MB.' })
    })
})
