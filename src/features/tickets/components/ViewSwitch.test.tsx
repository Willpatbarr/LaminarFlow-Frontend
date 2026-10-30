import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { ViewSwitch } from './ViewSwitch'

describe('ViewSwitch', () => {
    it('links Board to List with the default grouping, not an ungrouped list', () => {
        render(() => <ViewSwitch current="board" projectId="p1" boardId="b1" />)
        expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/projects/p1')
        expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/boards/b1')
        expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page')
    })

    it('carries the filter and still leaves the grouping at its default', () => {
        const filter = { op: 'and', conditions: [{ field: 'status', op: 'eq', value: 'x' }] } as never
        render(() => <ViewSwitch current="board" projectId="p1" boardId="b1" filter={filter} />)
        const href = screen.getByRole('link', { name: 'List' }).getAttribute('href')!
        expect(href).toContain('filter=')
        expect(href).not.toContain('group=')
    })
})
