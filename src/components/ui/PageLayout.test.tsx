import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { PageActions, PageLayout, PageRail, PageSubnav } from './PageLayout'

describe('PageLayout', () => {
    it('puts the title, the subnav and the actions in the header, and the body under it', () => {
        render(() => (
            <PageLayout title={<h1>Tickets</h1>}>
                <PageSubnav>
                    <a href="/a">Tab</a>
                </PageSubnav>
                <PageActions>
                    <button type="button">New ticket</button>
                </PageActions>
                <p>The body</p>
            </PageLayout>
        ))
        const header = screen.getByRole('heading', { name: 'Tickets' }).closest('header')!
        expect(header.classList.contains('page__header')).toBe(true)
        expect(header.querySelector('.page__subnav')).toContainElement(screen.getByRole('link', { name: 'Tab' }))
        // The actions are in the header's own right-hand slot, not in the title block.
        expect(header.querySelector(':scope > .page__actions')).toContainElement(screen.getByRole('button', { name: 'New ticket' }))
        expect(header.contains(screen.getByText('The body'))).toBe(false)
        expect(screen.getByText('The body').closest('.page__body')).not.toBeNull()
    })

    it('keeps the order things were put in a slot in', () => {
        render(() => (
            <PageLayout title={<h1>Project</h1>}>
                <PageSubnav>
                    <a href="/t">Tickets</a>
                </PageSubnav>
                <PageSubnav>
                    <span>Switch</span>
                </PageSubnav>
            </PageLayout>
        ))
        const slot = document.querySelector('.page__subnav')!
        expect(slot.textContent).toBe('TicketsSwitch')
    })

    it('has no header bar without a title', () => {
        render(() => (
            <PageLayout>
                <p>Just a body</p>
            </PageLayout>
        ))
        expect(document.querySelector('.page__header')).toBeNull()
        expect(screen.getByText('Just a body')).toBeInTheDocument()
    })

    it('sizes the body by the page: default, reading or wide', () => {
        const { unmount } = render(() => <PageLayout>x</PageLayout>)
        expect(document.querySelector('.page')!.classList.contains('page--default')).toBe(true)
        unmount()
        render(() => <PageLayout size="wide">x</PageLayout>)
        expect(document.querySelector('.page')!.classList.contains('page--wide')).toBe(true)
    })

    it('names the rail by its label, and draws no landmark when there is none', () => {
        const { unmount } = render(() => <PageLayout>x</PageLayout>)
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
        unmount()
        render(() => (
            <PageLayout>
                <PageRail label="Document actions">
                    <button type="button">Request review</button>
                </PageRail>
            </PageLayout>
        ))
        const rail = screen.getByRole('complementary', { name: 'Document actions' })
        expect(rail.closest('.page__rail')).not.toBeNull()
        expect(rail.closest('.page__body')).toBeNull()
    })

    it('leaves the slots where they are when there is no page around them', () => {
        render(() => (
            <>
                <PageActions>
                    <button type="button">Alone</button>
                </PageActions>
                <PageRail label="Side">
                    <p>Aside</p>
                </PageRail>
            </>
        ))
        expect(screen.getByRole('button', { name: 'Alone' })).toBeInTheDocument()
        expect(screen.getByRole('complementary', { name: 'Side' })).toBeInTheDocument()
    })
})
