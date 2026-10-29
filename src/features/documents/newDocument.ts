import { createDocument, currentProject, sync } from '@/sync'

import { CONTENT_KEY } from './content'

/*
┌─ documents ─────────────────────────────────────
│  makeDocument: the one way a new document is made and opened (LAM-97, LAM-115)
├─ out ───────────────────────────────────────────
│      makeDocument(navigate, { aspectTypeId?, projectId?, teamId? })   creates locally, then opens it
│      defaultTeamId()   the team a team-wide document is filed under when none is given
*/
// The team a team-wide document goes under when the caller names none: the picked
// project's team, else the first team. A document with a project has no team of its own.
export function defaultTeamId(): string | null {
    return currentProject()?.team_id ?? sync.teams[0]?.id ?? null
}

// A new document is normal, or an aspect of the type given. An aspect starts
// with every field empty: an absent key is an empty field. The write is local,
// so this works offline.
export async function makeDocument(
    navigate: (path: string) => void,
    options: { aspectTypeId?: string | null; projectId?: string | null; teamId?: string | null } = {},
) {
    const aspectTypeId = options.aspectTypeId ?? null
    // In a project, or team-wide: under a team, so that "team-wide" is true (LAM-138).
    const projectId = options.projectId ?? null
    const teamId = projectId ? null : (options.teamId ?? defaultTeamId())
    const document = await createDocument({
        title: '',
        type: aspectTypeId ? 'aspect' : 'normal',
        aspect_type_id: aspectTypeId,
        team_id: teamId,
        project_id: projectId,
        body: aspectTypeId ? {} : { [CONTENT_KEY]: '' },
    })
    navigate(`/documents/${document.id}`)
}
