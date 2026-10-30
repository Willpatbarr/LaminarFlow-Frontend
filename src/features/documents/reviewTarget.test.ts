import { createRoot, flush } from 'solid-js'

const make = () => {
    let made!: ReturnType<typeof createReviewTarget>
    const dispose = createRoot((d) => {
        made = createReviewTarget()
        return d
    })
    return { ...made, dispose }
}
import { describe, expect, it } from 'vitest'

import { createReviewTarget } from './reviewTarget'

describe('the field a page-level Request review acts on', () => {
    it('is none until text is selected, and the last field selected in after that', () => {
        {
            const { target, selectionIn, dispose } = make()
            expect(target()).toBeNull()
            const a = () => 'a'
            const b = () => 'b'
            selectionIn('a')(a)
            flush()
            expect(target()?.key).toBe('a')
            selectionIn('b')(b)
            flush()
            expect(target()?.begin).toBe(b)
            dispose()
        }
    })

    it('is not cleared by a field that no longer holds it, only by the one that does', () => {
        {
            const { target, selectionIn, dispose } = make()
            selectionIn('a')(() => '')
            flush()
            selectionIn('b')(() => '')
            flush()
            selectionIn('a')(null)
            flush()
            expect(target()?.key).toBe('b')
            selectionIn('b')(null)
            flush()
            expect(target()).toBeNull()
            dispose()
        }
    })
})
