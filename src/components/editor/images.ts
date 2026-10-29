import { Extension } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/*
┌─ components/editor ─────────────────────────────
│  images in the text (LAM-116): Markdown `![alt](/api/v1/attachments/<id>)`
├─ out ───────────────────────────────────────────
│      AttachmentImage   the image node; draws only this app's own attachments
│      ImageFiles        paste / drop of image files → options.onFiles
│      ImageUpload       what the caller supplies to turn a file into a URL
│      isAttachmentUrl   is this URL one of the server's attachment addresses?
│      altFromFilename   "Screen Shot [1].png" → "Screen Shot 1"
*/
// A Markdown image can point anywhere, and an `<img>` pointing anywhere is a
// request to someone else's server for every reader of the page (a tracking
// pixel). So the node keeps whatever Markdown it was given - the stored text is
// never rewritten - but only draws an image whose address is this server's
// attachment path; any other shows its alt text and address as plain text.

export type ImageUploadResult = { ok: true; url: string; alt: string } | { ok: false; message: string }
/** Uploads one image and says where it now lives. `onProgress` is 0 to 1. */
export type ImageUpload = (file: File, onProgress: (fraction: number) => void) => Promise<ImageUploadResult>

const ATTACHMENT_PATH = /^\/api\/v1\/attachments\/[0-9a-fA-F-]{8,}$/

export const isAttachmentUrl = (url: string) => ATTACHMENT_PATH.test(url)

export function altFromFilename(name: string): string {
    return name
        .replace(/\.[^.]*$/, '')
        .replace(/[[\]()<>\\`*_]/g, '')
        .trim()
}

export const AttachmentImage = Image.extend({
    renderHTML({ HTMLAttributes }) {
        const src = String(HTMLAttributes.src ?? '')
        if (isAttachmentUrl(src)) {
            return ['img', { src, alt: HTMLAttributes.alt ?? '', title: HTMLAttributes.title ?? null, loading: 'lazy', class: 'md-editor__image' }]
        }
        return ['span', { class: 'md-editor__image-blocked t-meta' }, `Image not shown: ${HTMLAttributes.alt || ''} (${src})`]
    },
})

type FilesOptions = {
    /** `at` is the document position of a drop, or null for a paste. */
    onFiles: (files: File[], at: number | null) => void
}

const isImage = (file: File) => file.type.startsWith('image/')

export const ImageFiles = Extension.create<FilesOptions>({
    name: 'imageFiles',

    addOptions() {
        return { onFiles: () => {} }
    },

    addProseMirrorPlugins() {
        const editor = this.editor
        const { onFiles } = this.options
        return [
            new Plugin({
                key: new PluginKey('imageFiles'),
                props: {
                    handlePaste(_view, event) {
                        if (!editor.isEditable) return false
                        const data = event.clipboardData
                        const files = [...(data?.files ?? [])].filter(isImage)
                        // Text that came with the files (copied from a page or a
                        // document) is pasted as text; a screenshot has none.
                        if (files.length === 0 || data?.getData('text/plain')) return false
                        event.preventDefault()
                        onFiles(files, null)
                        return true
                    },
                    handleDrop(view, event) {
                        if (!editor.isEditable) return false
                        const dropped = [...(event.dataTransfer?.files ?? [])]
                        if (dropped.length === 0) return false
                        // Any file dropped here would otherwise make the browser
                        // leave the page for it.
                        event.preventDefault()
                        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null
                        onFiles(dropped, at)
                        return true
                    },
                },
            }),
        ]
    },
})
