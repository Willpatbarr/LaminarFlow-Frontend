import { describe, expect, it } from 'vitest'

import type { DocFolder } from '@/sync'
import { doc } from '@/sync/testing/harness'

import { buildTree, destinations, folderContents, folderPath, insideOf, TOP_LEVEL } from './folderTree'

const folder = (id: string, name: string, parent_id: string | null = null): DocFolder => ({
    id,
    project_id: 'p-1',
    parent_id,
    name,
    version: 1,
})

const FOLDERS = [folder('f-specs', 'Specs'), folder('f-api', 'API', 'f-specs'), folder('f-v2', 'v2', 'f-api'), folder('f-notes', 'notes')]

describe('folderTree', () => {
    it('names a folder by its path from the top', () => {
        expect(folderPath('f-v2', FOLDERS)).toEqual(['Specs', 'API', 'v2'])
        expect(folderPath(null, FOLDERS)).toEqual([])
    })

    it('a folder cannot be moved into itself or anything inside it', () => {
        expect([...insideOf('f-specs', FOLDERS)].toSorted()).toEqual(['f-api', 'f-specs', 'f-v2'])
        expect(destinations(FOLDERS, { folderId: 'f-api' }).map((option) => option.label)).toEqual([
            'Top level (no folder)',
            'notes',
            'Specs',
        ])
        expect(destinations(FOLDERS)[0].value).toBe(TOP_LEVEL)
        expect(destinations(FOLDERS).map((option) => option.label)).toContain('Specs / API / v2')
    })

    it('builds the tree with folders by name, counts what is below, and keeps strays at the top', () => {
        const documents = [
            doc({ id: 'd-1', folder_id: 'f-v2' }),
            doc({ id: 'd-2', folder_id: 'f-specs' }),
            doc({ id: 'd-3', folder_id: null }),
            // Filed in a folder this device does not hold: shown at the top, not lost.
            doc({ id: 'd-4', folder_id: 'f-gone' }),
        ]
        const tree = buildTree(FOLDERS, documents)
        expect(tree.folders.map((node) => node.folder.name)).toEqual(['notes', 'Specs'])
        expect(tree.documents.map((document) => document.id)).toEqual(['d-3', 'd-4'])
        const specs = tree.folders[1]
        expect(specs.total).toBe(2)
        expect(specs.documents.map((document) => document.id)).toEqual(['d-2'])
        expect(specs.folders[0].folders[0].documents.map((document) => document.id)).toEqual(['d-1'])
    })

    it('says what a folder holds directly', () => {
        const documents = [doc({ id: 'd-1', folder_id: 'f-specs' }), doc({ id: 'd-2', folder_id: 'f-api' })]
        expect(folderContents('f-specs', FOLDERS, documents)).toEqual({ documents: 1, folders: 1 })
    })
})
