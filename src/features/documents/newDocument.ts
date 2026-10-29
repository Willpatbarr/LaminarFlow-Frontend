import { createDocument } from '@/sync'

import { CONTENT_KEY } from './content'

/*
┌─ documents ─────────────────────────────────────
│  makeDocument: the one way a new document is made and opened (LAM-97, LAM-115)
├─ out ───────────────────────────────────────────
│      makeDocument(navigate, { aspectTypeId?, projectId? })   creates locally, then opens it
*/
// A new document is normal, or an aspect of the type given. An aspect starts
// with every field empty: an absent key is an empty field. The write is local,
// so this works offline.
export async function makeDocument(
    navigate: (path: string) => void,
    options: { aspectTypeId?: string | null; projectId?: string | null } = {},
) {
    const aspectTypeId = options.aspectTypeId ?? null
    const document = await createDocument({
        title: '',
        type: aspectTypeId ? 'aspect' : 'normal',
        aspect_type_id: aspectTypeId,
        team_id: null,
        project_id: options.projectId ?? null,
        body: aspectTypeId ? {} : { [CONTENT_KEY]: '' },
    })
    navigate(`/documents/${document.id}`)
}
