import { createSignal } from 'solid-js'

import type { ImageUpload } from '@/components/editor/images'
import { altFromFilename } from '@/components/editor/images'
import { settledId } from '@/features/links/settled'

import { oversizeMessage } from './limits'
import { uploadAttachment, type AttachmentParent } from './api'

/*
┌─ attachments ───────────────────────────────────────
│  how the page's pieces share uploads (LAM-116)
├─ out ───────────────────────────────────────────────
│      imageUploader(parent)   an editor's `images` prop: file → stored attachment → Markdown URL
│      attachmentsVersion()    changes whenever an upload from an editor lands, so the list reloads
│      settledParent(parent)   the parent with a server id, waiting for a just-made row to sync
*/
// An image pasted into an editor is an attachment of the ticket or document the
// editor is on (a comment's image belongs to the thing it is a comment on), so
// it also shows in that page's attachments list. The list reads
// `attachmentsVersion` to know it should ask again.

const [version, setVersion] = createSignal(0)
export const attachmentsVersion = version

export async function settledParent(parent: AttachmentParent) {
    const id = parent.ticketId ?? parent.documentId
    const settled = await settledId(id)
    if (!settled.ok) return settled
    const resolved: AttachmentParent = parent.ticketId !== undefined ? { ticketId: settled.data } : { documentId: settled.data }
    return { ok: true as const, data: resolved }
}

export function imageUploader(parent: () => AttachmentParent): ImageUpload {
    return async (file, onProgress) => {
        // Before waiting for the parent or sending anything.
        const tooBig = oversizeMessage(file)
        if (tooBig) return { ok: false, message: tooBig }
        const owner = await settledParent(parent())
        if (!owner.ok) return { ok: false, message: owner.message }
        const result = await uploadAttachment(owner.data, file, { onProgress })
        if (!result.ok) return { ok: false, message: result.message }
        setVersion((n) => n + 1)
        return { ok: true, url: result.data.url, alt: altFromFilename(file.name) || 'image' }
    }
}
