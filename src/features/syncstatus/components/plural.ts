/** "1 change", "3 changes". */
export function changes(count: number): string {
    return `${count} ${count === 1 ? 'change' : 'changes'}`
}

/** "1 ticket", "3 tickets". */
export function tickets(count: number): string {
    return `${count} ${count === 1 ? 'ticket' : 'tickets'}`
}
