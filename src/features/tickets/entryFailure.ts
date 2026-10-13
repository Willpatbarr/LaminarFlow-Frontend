import { classify } from '@/api/errors'
import type { EntryError } from '@/sync'

/*
┌─ tickets ───────────────────────────────────────
│  turns the error on a parked outbox entry into words, at the field it is about
├─ out ───────────────────────────────────────────
│      describeFailure   EntryError → { fields, form, fieldShaped }
│      EditableField     title · description · status · assignee
├─ example ───────────────────────────────────────
│      422 [{location:'body.title', message:'expected length >= 1'}]
│        →  { fields: { title: "The server didn't accept this title: expected length >= 1." }, fieldShaped: true }
*/

export type EditableField = 'title' | 'description' | 'status' | 'assignee'

export type FailureDescription = {
    /** Words for the fields the server named. */
    fields: Partial<Record<EditableField, string>>
    /** Whatever could not be put on a field, or the whole explanation when
     *  there is no field to put it on. */
    form: string | null
    /** The user can fix this by editing a field, so editing resubmits. False:
     *  nothing they type will change the answer, and the way out is to discard. */
    fieldShaped: boolean
}

// `errors[].location` is a path into the request ("body.title"). Only the
// first segment after "body" names a field; anything deeper (an index, a
// nested member) still belongs to that field.
const FIELD_OF_LOCATION: Record<string, EditableField> = {
    title: 'title',
    description: 'description',
    status_id: 'status',
    assignee_id: 'assignee',
}

const NAME: Record<EditableField, string> = {
    title: 'title',
    description: 'description',
    status: 'status',
    assignee: 'assignee',
}

function fieldOf(location: string | undefined): EditableField | null {
    const match = /^body\.([A-Za-z0-9_]+)/.exec(location ?? '')
    return match ? (FIELD_OF_LOCATION[match[1]] ?? null) : null
}

const trimStop = (message: string) => message.trim().replace(/[.\s]+$/, '')

// The validator's own sentence is an engineering one ("expected length >= 1"),
// so it follows ours instead of replacing it: our words say what it means,
// theirs say what the rule is.
function fieldMessage(field: EditableField, serverMessage: string | undefined): string {
    const rule = serverMessage ? trimStop(serverMessage) : ''
    return rule
        ? `The server didn't accept this ${NAME[field]}: ${rule}.`
        : `The server didn't accept this ${NAME[field]}.`
}

export function describeFailure(error: EntryError): FailureDescription {
    const kind = classify(error)

    if (kind === 'validation') {
        const fields: FailureDescription['fields'] = {}
        const loose: string[] = []
        for (const detail of error.errors) {
            const field = fieldOf(detail.location)
            if (field) {
                fields[field] ??= fieldMessage(field, detail.message)
            } else if (detail.message) {
                loose.push(trimStop(detail.message))
            }
        }
        if (Object.keys(fields).length > 0) {
            return {
                fields,
                form: loose.length > 0 ? `Also: ${loose.join('; ')}.` : null,
                fieldShaped: true,
            }
        }
        return {
            fields,
            form:
                loose.length > 0
                    ? `The server didn't accept this change: ${loose.join('; ')}.`
                    : "The server didn't accept this change.",
            fieldShaped: false,
        }
    }

    if (kind === 'forbidden') {
        return {
            fields: {},
            form: "You don't have permission to make this change, so it was not saved.",
            fieldShaped: false,
        }
    }
    if (kind === 'not_found') {
        return {
            fields: {},
            form: 'This ticket is no longer available to you, so the change could not be saved.',
            fieldShaped: false,
        }
    }
    return {
        fields: {},
        form: "The server couldn't accept this change.",
        fieldShaped: false,
    }
}
