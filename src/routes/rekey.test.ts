import { describe, expect, it } from 'vitest'

import { rekeyedUrl } from './rekey'

const aliases = {
    tmp_sprint_1111: 'sp-9',
    tmp_epic_2222: 'e-9',
    tmp_saved_view_3333: 'sv-9',
    tmp_milestone_4444: 'm-9',
}

describe('rekeyedUrl', () => {
    it('swaps a temporary id in the path', () => {
        expect(rekeyedUrl('/sprints/tmp_sprint_1111', aliases)).toBe('/sprints/sp-9')
        expect(rekeyedUrl('/epics/tmp_epic_2222', aliases)).toBe('/epics/e-9')
        expect(rekeyedUrl('/milestones/tmp_milestone_4444', aliases)).toBe('/milestones/m-9')
    })

    it('swaps one in the query and keeps the rest of the address', () => {
        expect(rekeyedUrl('/?filter=%7B%7D&group=epic&view=tmp_saved_view_3333', aliases)).toBe('/?filter=%7B%7D&group=epic&view=sv-9')
        expect(rekeyedUrl('/boards/b-1?view=tmp_saved_view_3333#top', aliases)).toBe('/boards/b-1?view=sv-9#top')
    })

    it('swaps several, and leaves ids it has no answer for', () => {
        expect(rekeyedUrl('/sprints/tmp_sprint_1111?view=tmp_saved_view_3333&x=tmp_epic_9999', aliases)).toBe(
            '/sprints/sp-9?view=sv-9&x=tmp_epic_9999',
        )
    })

    it('says null when nothing changes', () => {
        expect(rekeyedUrl('/sprints/sp-9', aliases)).toBeNull()
        expect(rekeyedUrl('/sprints/tmp_sprint_unknown', aliases)).toBeNull()
        expect(rekeyedUrl('/', {})).toBeNull()
    })
})
