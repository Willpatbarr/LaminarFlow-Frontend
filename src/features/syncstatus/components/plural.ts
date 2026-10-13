/** "1 change", "3 changes". */
export function changes(count: number): string {
    return `${count} ${count === 1 ? 'change' : 'changes'}`
}
