// What the ticket screens show while the first load from the server is still
// on its way and there is nothing on disk to show instead. Deliberately plain
// and deliberately named for the situation: LAM-69 replaces it with skeletons,
// so nothing else should depend on how it looks.
export function TicketsPending() {
    return (
        <p class="tickets__pending t-meta" role="status">
            Loading…
        </p>
    )
}
