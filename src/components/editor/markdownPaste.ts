import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/*
┌─ components/editor ─────────────────────────────
│  pasted Markdown renders (@tiptap/markdown parses what it is given, but does
│  not look at the clipboard)
├─ out ───────────────────────────────────────────
│      MarkdownPaste      the extension
│      looksLikeMarkdown  does this plain text use Markdown syntax?
├─ example ───────────────────────────────────────
│      looksLikeMarkdown('## Title\n\n- a')  →  true
│      looksLikeMarkdown('just a sentence.')  →  false
*/
// A line that opens a heading, list item, task, quote or fence, or a span that
// is bold, code or a link. Text without any of these goes through the editor's
// own paste untouched, so an ordinary sentence is never re-parsed.
const BLOCK = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|```|~~~|\s*[-*_]{3,}\s*$)/m
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/

export function looksLikeMarkdown(text: string): boolean {
    return BLOCK.test(text) || INLINE.test(text)
}

export const MarkdownPaste = Extension.create({
    name: 'markdownPaste',

    addProseMirrorPlugins() {
        const editor = this.editor
        return [
            new Plugin({
                key: new PluginKey('markdownPaste'),
                props: {
                    handlePaste(_view, event) {
                        const data = event.clipboardData
                        const text = data?.getData('text/plain') ?? ''
                        if (!text || !looksLikeMarkdown(text)) return false
                        // Code is code: pasting into a code block stays literal.
                        if (editor.isActive('codeBlock')) return false
                        // Rich text copied from a page keeps its own formatting. A code
                        // editor also puts HTML on the clipboard, but what it copied
                        // was source text, which is what this is for.
                        const rich = data?.types.includes('text/html') && !data.types.includes('vscode-editor-data')
                        if (rich) return false
                        return editor.commands.insertContent(text, { contentType: 'markdown' } as never)
                    },
                },
            }),
        ]
    },
})
