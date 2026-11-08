import type { Doc, DocFolder } from '@/sync'

/*
┌─ documents ─────────────────────────────────────
│  folderTree: a project's folders and documents as a tree (pure)
├─ out ───────────────────────────────────────────
│      TOP_LEVEL                         the "no folder" value of a destination picker
│      folderPath(id, folders)           ['Specs', 'API'] - the names from the top down
│      pathLabel(id, folders)            'Specs / API'
│      insideOf(id, folders)             the folder's own id and every folder below it
│      destinations(folders, moving?)    where something can be moved: the top level, then every folder by path
│      folderContents(id, folders, docs) how many documents and folders a folder holds directly
│      FolderNode, buildTree(folders, docs)   the tree the list draws
├─ example ───────────────────────────────────────
│      destinations(folders, { folderId: 'f-1' })  →  every folder but f-1 and those inside it
*/
// A folder's documents are the ones whose `folder_id` is its id. A document or
// folder that names a folder this device does not hold (one deleted elsewhere,
// before the moves it made have arrived) is shown at the top level rather than
// lost.

export const TOP_LEVEL = ''

const byName = (a: DocFolder, b: DocFolder) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)

export function folderPath(id: string | null | undefined, folders: readonly DocFolder[]): string[] {
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    const names: string[] = []
    const seen = new Set<string>()
    let at = id ? byId.get(id) : undefined
    while (at && !seen.has(at.id)) {
        seen.add(at.id)
        names.unshift(at.name)
        at = at.parent_id ? byId.get(at.parent_id) : undefined
    }
    return names
}

export function pathLabel(id: string | null | undefined, folders: readonly DocFolder[]): string {
    return folderPath(id, folders).join(' / ')
}

/** The folder and everything below it: where it cannot be moved to. */
export function insideOf(id: string, folders: readonly DocFolder[]): Set<string> {
    const out = new Set([id])
    let grew = true
    while (grew) {
        grew = false
        for (const folder of folders) {
            if (folder.parent_id && out.has(folder.parent_id) && !out.has(folder.id)) {
                out.add(folder.id)
                grew = true
            }
        }
    }
    return out
}

/** Where a document, or a folder (`folderId`), can be moved: the top level, then every
 *  folder by its path. A folder cannot go inside itself or one of its own. */
export function destinations(
    folders: readonly DocFolder[],
    moving: { folderId?: string } = {},
): { value: string; label: string }[] {
    const barred = moving.folderId ? insideOf(moving.folderId, folders) : new Set<string>()
    return [
        { value: TOP_LEVEL, label: 'Top level (no folder)' },
        ...folders
            .filter((folder) => !barred.has(folder.id))
            .map((folder) => ({ value: folder.id, label: pathLabel(folder.id, folders) }))
            .toSorted((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    ]
}

/** What a folder holds directly - what deleting it moves up a level. */
export function folderContents(
    id: string,
    folders: readonly DocFolder[],
    documents: readonly Doc[],
): { documents: number; folders: number } {
    return {
        documents: documents.filter((document) => (document.folder_id ?? null) === id).length,
        folders: folders.filter((folder) => folder.parent_id === id).length,
    }
}

export type FolderNode = {
    folder: DocFolder
    folders: FolderNode[]
    documents: Doc[]
    /** Every document at or below this folder: for the count beside its name. */
    total: number
}

/** The tree: top-level folders and documents, each folder with its own. Folders by
 *  name; documents in the order given. */
export function buildTree(
    folders: readonly DocFolder[],
    documents: readonly Doc[],
): { folders: FolderNode[]; documents: Doc[] } {
    const known = new Set(folders.map((folder) => folder.id))
    const parentOf = (folder: DocFolder) => (folder.parent_id && known.has(folder.parent_id) ? folder.parent_id : null)
    const folderOf = (document: Doc) => (document.folder_id && known.has(document.folder_id) ? document.folder_id : null)

    // A cycle cannot be made (the server refuses it), but a half-applied set of moves
    // could show one for a moment; anything not reached from the top is put there.
    const placed = new Set<string>()
    const node = (folder: DocFolder): FolderNode => {
        placed.add(folder.id)
        const children = folders
            .filter((child) => parentOf(child) === folder.id && !placed.has(child.id))
            .toSorted(byName)
            .map(node)
        const own = documents.filter((document) => folderOf(document) === folder.id)
        return {
            folder,
            folders: children,
            documents: own,
            total: own.length + children.reduce((sum, child) => sum + child.total, 0),
        }
    }

    const top = folders.filter((folder) => parentOf(folder) === null).toSorted(byName).map(node)
    const stray = folders.filter((folder) => !placed.has(folder.id)).toSorted(byName).map(node)
    return { folders: [...top, ...stray], documents: documents.filter((document) => folderOf(document) === null) }
}
