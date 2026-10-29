import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { Table, TableRow } from './Table'

// The stacked narrow layout (LAM-140) is CSS only, so the markup it relies on
// is what is worth pinning: the first cell is the title, the header is
// decoration, and row buttons are real buttons beside the link.
describe('Table', () => {
    it('keeps the header out of the accessibility tree and the title as the first cell', () => {
        const { container } = render(() => (
            <Table columns={['Title', 'Status']} template="1fr 100px">
                <TableRow href="/t/1" actions={<button type="button">Archive One</button>}>
                    <span class="table__text">One</span>
                    <span>Open</span>
                </TableRow>
            </Table>
        ))
        expect(container.querySelector('.table__header')).toHaveAttribute('aria-hidden', 'true')
        const link = screen.getByRole('link', { name: /One/ })
        expect(link.firstElementChild).toHaveTextContent('One')
        const archive = screen.getByRole('button', { name: 'Archive One' })
        expect(link.contains(archive)).toBe(false)
        expect(archive.closest('.table__item')).toBe(link.closest('.table__item'))
    })
})
