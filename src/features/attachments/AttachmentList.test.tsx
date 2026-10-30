import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ok, stubFetch } from '@/testing/fetch'

import { AttachmentList } from './AttachmentList'

const TICKET = '11111111-1111-4111-8111-111111111111'

const big = (name: string, mb: number) => {
    const file = new File(['x'], name)
    Object.defineProperty(file, 'size', { value: mb * 1024 * 1024 })
    return file
}

beforeEach(() => {
    stubFetch({
        'POST /api/v1/attachments/list': () => ok({ items: [], next_cursor: null }),
        'POST /api/v1/members/list': () => ok({ items: [], next_cursor: null }),
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('AttachmentList upload feedback', () => {
    it('refuses an oversize file up front, never starting an upload', async () => {
        const xhr = vi.fn()
        vi.stubGlobal('XMLHttpRequest', xhr)
        const user = userEvent.setup({ applyAccept: false })
        render(() => <AttachmentList parent={{ ticketId: TICKET }} />)
        await screen.findByText('No attachments.')

        await user.upload(screen.getByLabelText('Attach files'), big('report.pdf', 31))

        expect(await screen.findByRole('alert')).toHaveTextContent('report.pdf is 31 MB; the limit is 25 MB.')
        expect(xhr).not.toHaveBeenCalled()
        expect(screen.queryByRole('progressbar')).toBeNull()
    })

    it('replaces the previous message when a new upload starts, and can be dismissed', async () => {
        vi.stubGlobal('XMLHttpRequest', vi.fn())
        const user = userEvent.setup({ applyAccept: false })
        render(() => <AttachmentList parent={{ ticketId: TICKET }} />)
        await screen.findByText('No attachments.')

        await user.upload(screen.getByLabelText('Attach files'), big('first.bin', 30))
        await screen.findByText(/first\.bin is 30 MB/)
        await user.upload(screen.getByLabelText('Attach files'), big('second.bin', 40))
        expect(await screen.findByText(/second\.bin is 40 MB/)).toBeInTheDocument()
        expect(screen.queryByText(/first\.bin/)).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Dismiss' }))
        expect(screen.queryByRole('alert')).toBeNull()
    })
})
