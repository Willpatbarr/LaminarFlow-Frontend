import { describe, expect, it } from 'vitest'

import { filteredProjectId, NO_PROJECT, projectFilterOf, withProjectFilter } from './projectFilter'

describe('the /documents project filter in the address', () => {
    it('reads all, team-wide or a project', () => {
        expect(projectFilterOf('')).toBe('')
        expect(projectFilterOf('?project=none')).toBe(NO_PROJECT)
        expect(projectFilterOf('?project=p-1')).toBe('p-1')
    })

    it('names a project id only for a project', () => {
        expect(filteredProjectId('?project=p-1')).toBe('p-1')
        expect(filteredProjectId('?project=none')).toBeNull()
        expect(filteredProjectId('')).toBeNull()
    })

    it('writes the filter and keeps other params; all drops it', () => {
        expect(withProjectFilter('', 'p-1')).toBe('?project=p-1')
        expect(withProjectFilter('?x=1', 'none')).toBe('?x=1&project=none')
        expect(withProjectFilter('?project=p-1&x=1', '')).toBe('?x=1')
        expect(withProjectFilter('?project=p-1', '')).toBe('')
    })
})
