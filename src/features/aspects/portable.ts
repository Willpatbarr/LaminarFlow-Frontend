import type { components } from '@/api/schema'

/*
┌─ aspects ───────────────────────────────────────
│  the portable aspect type file (LAM-119): reading one, naming one, saving one
├─ out ───────────────────────────────────────────
│      Portable                  { format_version, name, fields[{label, position}] }
│      parsePortable(text)       the file's content checked, or the first thing wrong with it
│      exportFileName(name)      "Design Brief" → "design-brief.aspect-type.json"
│      downloadJson(name, data)  hands `data` to the browser as a file
*/
// The server checks the file again on import (docs/aspect-type-format.md in the
// backend) and is the authority; this check exists so a wrong file is named
// before a request is made and a preview is only shown for a file that can work.
// It follows the same rules, including strictness about unknown keys.

export type Portable = components['schemas']['PortableBody']

export type Parsed = { ok: true; file: { format_version: 1; name: string; fields: { label: string; position: number }[] } } | { ok: false; message: string }

const MAX_FIELDS = 100
const MAX_LENGTH = 100
const MAX_POSITION = 1_000_000

const bad = (message: string): Parsed => ({ ok: false, message })
const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const unknownKey = (value: Record<string, unknown>, known: string[], where: string) => {
    const key = Object.keys(value).find((candidate) => !known.includes(candidate))
    return key === undefined ? undefined : `${where}${where ? '.' : ''}${key}`
}
const lengthProblem = (text: string) =>
    text.trim() === '' ? 'must not be empty' : [...text].length > MAX_LENGTH ? `must be at most ${MAX_LENGTH} characters` : undefined

export function parsePortable(text: string): Parsed {
    let data: unknown
    try {
        data = JSON.parse(text)
    } catch {
        return bad('This file is not valid JSON.')
    }
    if (!isObject(data)) return bad('This file is not an aspect type: expected a JSON object.')
    const extra = unknownKey(data, ['format_version', 'name', 'fields', '$schema'], '')
    if (extra) return bad(`${extra}: not part of the aspect type format.`)
    if (!('format_version' in data)) return bad('format_version: missing.')
    if (!Number.isInteger(data.format_version)) return bad('format_version: must be a whole number.')
    if (data.format_version !== 1) {
        return bad(`format_version: ${String(data.format_version)} is not supported. This app reads version 1.`)
    }
    if (typeof data.name !== 'string') return bad('name: missing or not text.')
    const nameProblem = lengthProblem(data.name)
    if (nameProblem) return bad(`name: ${nameProblem}.`)
    if (!Array.isArray(data.fields)) return bad('fields: missing or not a list.')
    if (data.fields.length > MAX_FIELDS) return bad(`fields: at most ${MAX_FIELDS}, this file has ${data.fields.length}.`)

    const fields: { label: string; position: number }[] = []
    for (const [index, entry] of data.fields.entries()) {
        const where = `fields[${index}]`
        if (!isObject(entry)) return bad(`${where}: must be an object with a label and a position.`)
        const stray = unknownKey(entry, ['label', 'position'], where)
        if (stray) return bad(`${stray}: not part of the aspect type format.`)
        if (typeof entry.label !== 'string') return bad(`${where}.label: missing or not text.`)
        const labelProblem = lengthProblem(entry.label)
        if (labelProblem) return bad(`${where}.label: ${labelProblem}.`)
        if (!Number.isInteger(entry.position) || (entry.position as number) < 0 || (entry.position as number) > MAX_POSITION) {
            return bad(`${where}.position: must be a whole number from 0 to ${MAX_POSITION}.`)
        }
        fields.push({ label: entry.label, position: entry.position as number })
    }
    // Position is ordering only; the server numbers 1..n. Show them in that order.
    const ordered = fields.map((field, index) => ({ field, index })).sort((a, b) => a.field.position - b.field.position || a.index - b.index)
    return { ok: true, file: { format_version: 1, name: data.name, fields: ordered.map((entry) => entry.field) } }
}

export function exportFileName(typeName: string): string {
    const slug = typeName
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '')
    return `${slug || 'aspect-type'}.aspect-type.json`
}

export function downloadJson(fileName: string, data: unknown) {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.append(link)
    link.click()
    link.remove()
    // After the click has been handled; revoking at once can cancel the save.
    setTimeout(() => URL.revokeObjectURL(url), 0)
}
