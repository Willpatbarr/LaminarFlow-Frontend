import { Button } from '@/components/ui/Button'

// Placeholder data until LAM-7 lands the API contract. The folder shape is the
// point of this file, not the content.
const tickets = ['Split the backend CI', 'Stand up the frontend test harness']

export function TicketList() {
    return (
        <section>
            <h1>Tickets</h1>
            <ul>
                {tickets.map((title) => (
                    <li key={title}>{title}</li>
                ))}
            </ul>
            <Button>New ticket</Button>
        </section>
    )
}