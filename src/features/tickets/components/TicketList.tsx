import { For } from 'solid-js'

import { Button } from '@/components/ui/Button'

// Placeholder data until LAM-7 lands the API contract. The folder shape is the
// point of this file, not the content.
const tickets = ['Split the backend CI', 'Stand up the frontend test harness']

export function TicketList() {
    return (
        <section>
            <h1>Tickets</h1>
            <ul>
                {/* No `key` prop in Solid: <For> tracks its items itself. */}
                <For each={tickets}>{(title) => <li>{title}</li>}</For>
            </ul>
            <Button>New ticket</Button>
        </section>
    )
}
