import type { ActivityEntry } from '@/sync'

/*
┌─ activity ──────────────────────────────────────
│  one plain sentence per activity entry (LAM-114)
├─ out ───────────────────────────────────────────
│      Names                    how ids become names (each undefined when unknown)
│      describe(entry, names)   "Will moved this from To do to In progress"
*/
// Pure: the names arrive as functions so the sentence is testable and the screen
// decides where they come from (the local stores, the member list). The log keeps
// ids, not names, so a rename shows in old entries; an id nobody holds any more
// (a deleted label, say) is said as "one that was removed", not guessed at.

export type Names = {
    /** The viewer's own account id: said as "You". */
    me: string
    person(id: string): string | undefined
    status(id: string): string | undefined
    epic(id: string): string | undefined
    label(id: string): string | undefined
    milestone(id: string): string | undefined
    aspectType(id: string): string | undefined
}

export function actorName(entry: ActivityEntry, names: Names): string {
    if (entry.actor_id === null) return 'Someone'
    if (entry.actor_id === names.me && names.me !== '') return 'You'
    return names.person(entry.actor_id) ?? 'Someone'
}

const quoted = (text: string | null) => (text === null || text === '' ? '' : ` "${text}"`)

export function describe(entry: ActivityEntry, names: Names): string {
    const who = actorName(entry, names)
    const thing = entry.entity_type === 'ticket' ? 'ticket' : 'document'
    const before = entry.summary_before
    const after = entry.summary_after
    const lookup = (find: (id: string) => string | undefined, id: string | null, gone: string) =>
        id === null ? gone : (find(id) ?? gone)

    switch (entry.kind) {
        case 'created':
            return `${who} created this ${thing}`
        case 'archived':
            return `${who} archived this ${thing}`
        case 'unarchived':
            return `${who} restored this ${thing}`
        case 'status_changed': {
            const to = lookup(names.status, after, 'another status')
            return before === null
                ? `${who} set the status to ${to}`
                : `${who} moved this from ${lookup(names.status, before, 'another status')} to ${to}`
        }
        case 'assignee_changed':
            return after === null
                ? `${who} removed the assignee`
                : `${who} assigned this to ${after === names.me ? 'you' : lookup(names.person, after, 'someone')}`
        case 'parent_changed':
            return after === null
                ? `${who} took this out of its epic`
                : `${who} put this under the epic ${lookup(names.epic, after, 'one that was removed')}`
        case 'label_added':
            return `${who} added the label ${lookup(names.label, after, 'one that was removed')}`
        case 'label_removed':
            return `${who} removed the label ${lookup(names.label, before, 'one that was removed')}`
        case 'aspect_type_changed':
            if (after === null) return `${who} made this a normal document`
            return before === null
                ? `${who} made this an Aspect (${lookup(names.aspectType, after, 'a type that was removed')})`
                : `${who} changed the aspect type to ${lookup(names.aspectType, after, 'a type that was removed')}`
        case 'field_changed':
            switch (entry.field) {
                case 'title':
                    return `${who} changed the title to${quoted(after) || ' nothing'}`
                case 'description':
                    return `${who} changed the description`
                case 'milestone':
                    return after === null
                        ? `${who} cleared the milestone`
                        : `${who} set the milestone to ${lookup(names.milestone, after, 'one that was removed')}`
                case 'fields':
                    return `${who} changed some of this document's fields`
                default:
                    return `${who} changed this ${thing}`
            }
        default:
            return `${who} changed this ${thing}`
    }
}
