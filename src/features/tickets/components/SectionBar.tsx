import { createMemo, createSignal, For, onSettled } from 'solid-js'

import { commentsFor } from '@/sync'

// LAM-189. On a phone the ticket page is one long column, and Comments and
// Activity sit far below the fields. This bar stays under the top bar and jumps
// to each section: the link scrolls there (the headings carry scroll-margin-top,
// so the top bar and this bar do not cover them) and moves focus to the heading.
// Shown on phones only (tickets.css); on wider screens the page is as it was.

type Section = { key: 'details' | 'comments' | 'activity'; label: string; target: string }

const SECTIONS: Section[] = [
    { key: 'details', label: 'Details', target: 'ticket-details' },
    { key: 'comments', label: 'Comments', target: 'comments-title' },
    { key: 'activity', label: 'Activity', target: 'activity-title' },
]

export function SectionBar(props: { ticketId: string; title: () => HTMLElement | undefined }) {
    const count = createMemo(() => commentsFor(props.ticketId).length)
    const [current, setCurrent] = createSignal<Section['key']>('details')

    // The current section is the last one whose top has reached the bottom of
    // the two sticky bars.
    onSettled(() => {
        const update = () => {
            const probe = window.innerHeight * 0.3
            let found: Section['key'] = 'details'
            for (const section of SECTIONS) {
                const el = document.getElementById(section.target)
                if (el && el.getBoundingClientRect().top <= probe) found = section.key
            }
            // At the foot of the page the last section cannot reach the probe line.
            if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) found = 'activity'
            setCurrent(found)
        }
        update()
        window.addEventListener('scroll', update, { passive: true })
        return () => window.removeEventListener('scroll', update)
    })

    const jump = (event: MouseEvent, section: Section) => {
        event.preventDefault()
        const el = document.getElementById(section.target)
        if (!el) return
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
        // Details has no heading of its own: focus lands on the title field.
        const focusEl = section.key === 'details' ? props.title() : el
        focusEl?.focus({ preventScroll: true })
        setCurrent(section.key)
    }

    return (
        <nav class="ticket__sections" aria-label="Ticket sections">
            <For each={SECTIONS}>
                {(section) => (
                    <a
                        href={`#${section.target}`}
                        // Not the router's: it would mark every in-page link as the current page.
                        rel="external"
                        class="ticket__section-link t-body"
                        aria-current={current() === section.key ? 'location' : undefined}
                        onClick={(event) => jump(event, section)}
                    >
                        {section.label}
                        {section.key === 'comments' && count() > 0 ? ` (${count()})` : ''}
                    </a>
                )}
            </For>
        </nav>
    )
}
