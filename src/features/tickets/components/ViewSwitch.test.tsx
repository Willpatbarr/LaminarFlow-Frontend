import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { useShortcut } from '@/features/shortcuts/registry'

import { ViewSwitch } from './ViewSwitch'

// The shell binds these two; a hint shows only for a key that is bound.
function Bound(props: { current: 'list' | 'board' }) {
    useShortcut('nav.tickets', () => {})
    useShortcut('nav.board', () => {})
    return <ViewSwitch current={props.current} projectId="p1" boardId="b1" />
}

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

    it('shows the same keys on both screens, one on each segment', () => {
        const { unmount } = render(() => <Bound current="list" />)
        const text = () => document.querySelector('.view-switch')!.textContent
        const onList = text()
        expect(onList).toBe('ListG then TBoardG then B')
        unmount()
        render(() => <Bound current="board" />)
        expect(text()).toBe(onList)
    })
})
