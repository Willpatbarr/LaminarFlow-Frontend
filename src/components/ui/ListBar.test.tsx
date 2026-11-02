import { render, screen, within } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { ListBar, ListBars, MetaChip } from './ListBar'

describe('ListBar', () => {
    it('is a link named by its title alone; the chips beside it are not part of the name', () => {
        render(() => (
            <ListBars label="Documents">
                <ListBar
                    href="/documents/d-1"
                    title="Prototype checklist"
                    meta={
                        <>
                            <MetaChip>Team-wide</MetaChip>
                            <MetaChip>Document</MetaChip>
                        </>
                    }
                />
            </ListBars>
        ))
        const link = screen.getByRole('link', { name: 'Prototype checklist' })
        expect(link).toHaveAttribute('href', '/documents/d-1')
        const item = within(screen.getByRole('list', { name: 'Documents' })).getByRole('listitem')
        expect(within(item).getByText('Team-wide')).toBeInTheDocument()
        expect(link).not.toHaveTextContent('Team-wide')
    })

    it('without an href the title is plain text and its own controls stay links of their own', () => {
        render(() => (
            <ListBars label="Teams">
                <ListBar
                    title="Fishboy"
                    actions={
                        <a class="chip meta-chip" href="/teams/t-1/settings">
                            Team settings
                        </a>
                    }
                />
            </ListBars>
        ))
        expect(screen.queryByRole('link', { name: 'Fishboy' })).not.toBeInTheDocument()
        expect(screen.getByText('Fishboy')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Team settings' })).toHaveAttribute('href', '/teams/t-1/settings')
    })

    it('shows a subtitle and a full-width row below when given', () => {
        render(() => (
            <ListBars>
                <ListBar href="/x" title="Sprint 1" subtitle="List · Team" below={<progress aria-label="Progress" />} />
            </ListBars>
        ))
        expect(screen.getByText('List · Team')).toBeInTheDocument()
        expect(screen.getByRole('progressbar', { name: 'Progress' }).closest('.list-bar__below')).not.toBeNull()
    })
})
