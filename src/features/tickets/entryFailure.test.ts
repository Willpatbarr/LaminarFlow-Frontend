import { describe, expect, it } from 'vitest'

import { describeFailure } from './entryFailure'

const error = (status: number, errors: { location?: string; message?: string }[] = []) => ({
    status,
    code: 'x',
    errors,
})

describe('describeFailure', () => {
    it('puts each message at the field its location names', () => {
        const result = describeFailure(
            error(422, [
                { location: 'body.title', message: 'expected length <= 200' },
                { location: 'body.description', message: 'is required.' },
                { location: 'body.status_id', message: 'expected a uuid' },
                { location: 'body.assignee_id', message: 'expected a uuid' },
            ]),
        )

        expect(result.fieldShaped).toBe(true)
        expect(result.form).toBeNull()
        expect(result.fields).toEqual({
            title: "The server didn't accept this title: expected length <= 200.",
            description: "The server didn't accept this description: is required.",
            status: "The server didn't accept this status: expected a uuid.",
            assignee: "The server didn't accept this assignee: expected a uuid.",
        })
    })

    it('says a status or assignee that has gone is gone, at its own control', () => {
        const gone = (code: string, location: string) => ({
            status: 422,
            code,
            errors: [{ location, message: 'status not found' }],
        })

        expect(describeFailure(gone('status_not_found', 'body.status_id'))).toEqual({
            fields: { status: 'That status no longer exists. Pick another.' },
            form: null,
            fieldShaped: true,
        })
        expect(describeFailure(gone('assignee_not_found', 'body.assignee_id'))).toEqual({
            fields: { assignee: 'That assignee is no longer available. Pick another.' },
            form: null,
            fieldShaped: true,
        })
    })

    it('keeps the first message for a field named twice', () => {
        const result = describeFailure(
            error(422, [
                { location: 'body.title', message: 'first' },
                { location: 'body.title', message: 'second' },
            ]),
        )
        expect(result.fields.title).toContain('first')
    })

    it('puts what it cannot place in a form-level message beside the fields it can', () => {
        const result = describeFailure(
            error(422, [
                { location: 'body.title', message: 'too long' },
                { location: 'body.project_id', message: 'unknown project' },
                { message: 'something else' },
            ]),
        )
        expect(result.fieldShaped).toBe(true)
        expect(result.fields).toEqual({ title: "The server didn't accept this title: too long." })
        expect(result.form).toBe('Also: unknown project; something else.')
    })

    it('is not field-shaped when no error names a field', () => {
        const result = describeFailure(error(422, [{ location: 'body.project_id', message: 'unknown project' }]))
        expect(result).toEqual({
            fields: {},
            form: "The server didn't accept this change: unknown project.",
            fieldShaped: false,
        })
        expect(describeFailure(error(400)).fieldShaped).toBe(false)
    })

    it('explains a 403 and a 404 in plain words, with nothing to edit', () => {
        expect(describeFailure(error(403))).toMatchObject({
            fieldShaped: false,
            form: expect.stringContaining("don't have permission"),
        })
        expect(describeFailure(error(404))).toMatchObject({
            fieldShaped: false,
            form: expect.stringContaining('no longer available'),
        })
        expect(describeFailure(error(405))).toMatchObject({ fieldShaped: false })
    })
})

describe('describeFailure for a body over the size limit', () => {
    it('blames the longer of the title and the description', () => {
        expect(describeFailure(error(413), { title: 'short', description: 'much much longer' })).toEqual({
            fields: { description: "The server didn't accept this description: it is too long to send." },
            form: null,
            fieldShaped: true,
        })
        expect(describeFailure(error(413), { title: 'a long title', description: '' }).fields).toEqual({
            title: "The server didn't accept this title: it is too long to send.",
        })
    })

    it('says so for the form, and still lets the user edit, when it does not know what was sent', () => {
        expect(describeFailure(error(413))).toMatchObject({
            fields: {},
            form: expect.stringContaining('too large'),
            fieldShaped: true,
        })
    })
})
