import type { FilterCondition, FilterGroup } from './config'

/*
┌─ tickets/listView ──────────────────────────────
│  FilterModel: the filter bar's fields <-> the filter language
├─ out ───────────────────────────────────────────
│      PICK_FIELDS, PickField, FilterModel, FieldPick, emptyModel
│      toGroup, fromGroup, isFilterActive
├─ example ───────────────────────────────────────
│      status in [a, b] or none, title contains "pay"
│        →  { op: and, conditions: [title contains, …], groups: [{ op: or, … }] }
*/
// The bar is deliberately a small thing: a text box on the title and, per
// field, "any of these" plus "none". It builds ordinary LAM-58 conditions, so
// what it produces is exactly what POST /tickets/list and a saved view accept.
//
// `fromGroup` is the other direction and it is strict: it recognises only what
// `toGroup` writes (and `eq` for a single value). A saved view with a nested or
// hand-written filter is `null` here, which the bar shows as "advanced filter"
// instead of rewriting it into something it is not.

export const PICK_FIELDS = ['status', 'assignee', 'epic', 'milestone', 'label', 'sprint'] as const
export type PickField = (typeof PICK_FIELDS)[number]

export type FieldPick = {
    /** Any of these ids. */
    ids: string[]
    /** Or no value at all (no status, unassigned, no label…). */
    none: boolean
}

export type FilterModel = {
    /** The title contains this, any case. */
    text: string
    picks: Record<PickField, FieldPick>
}

export function emptyModel(): FilterModel {
    const picks = {} as Record<PickField, FieldPick>
    for (const field of PICK_FIELDS) picks[field] = { ids: [], none: false }
    return { text: '', picks }
}

export function isFilterActive(model: FilterModel): boolean {
    return (
        model.text.trim() !== '' ||
        PICK_FIELDS.some((field) => model.picks[field].ids.length > 0 || model.picks[field].none)
    )
}

export function toGroup(model: FilterModel): FilterGroup | undefined {
    const conditions: FilterCondition[] = []
    const groups: FilterGroup[] = []
    const text = model.text.trim()
    if (text !== '') conditions.push({ field: 'title', op: 'contains', value: text })
    for (const field of PICK_FIELDS) {
        const { ids, none } = model.picks[field]
        const any: FilterCondition | null = ids.length > 0 ? { field, op: 'in', value: ids } : null
        const unset: FilterCondition | null = none ? { field, op: 'is_null' } : null
        if (any && unset) groups.push({ op: 'or', conditions: [any, unset] })
        else if (any ?? unset) conditions.push((any ?? unset)!)
    }
    if (conditions.length === 0 && groups.length === 0) return undefined
    const group: FilterGroup = { op: 'and' }
    if (conditions.length > 0) group.conditions = conditions
    if (groups.length > 0) group.groups = groups
    return group
}

const pickFields: readonly string[] = PICK_FIELDS

/** One field's condition(s) as a pick, or null when they say anything else. */
function readPick(conditions: FilterCondition[]): { field: PickField; pick: FieldPick } | null {
    const field = conditions[0]?.field
    if (!field || !pickFields.includes(field) || conditions.some((c) => c.field !== field)) return null
    const pick: FieldPick = { ids: [], none: false }
    for (const condition of conditions) {
        if (condition.op === 'is_null' && !pick.none) pick.none = true
        else if (condition.op === 'in' && Array.isArray(condition.value) && pick.ids.length === 0) {
            if (!condition.value.every((v) => typeof v === 'string')) return null
            pick.ids = condition.value as string[]
        } else if (condition.op === 'eq' && typeof condition.value === 'string' && pick.ids.length === 0) {
            pick.ids = [condition.value]
        } else return null
    }
    return { field: field as PickField, pick }
}

export function fromGroup(group: FilterGroup | undefined): FilterModel | null {
    const model = emptyModel()
    if (!group) return model
    if (group.op !== 'and') return null
    const seen = new Set<string>()
    const take = (field: PickField, pick: FieldPick) => {
        if (seen.has(field)) return false
        seen.add(field)
        model.picks[field] = pick
        return true
    }
    for (const condition of group.conditions ?? []) {
        if (condition.field === 'title' && condition.op === 'contains' && typeof condition.value === 'string') {
            if (model.text !== '') return null
            model.text = condition.value
            continue
        }
        const read = readPick([condition])
        if (!read || !take(read.field, read.pick)) return null
    }
    for (const inner of group.groups ?? []) {
        if (inner.op !== 'or' || (inner.groups?.length ?? 0) > 0 || inner.conditions?.length !== 2) return null
        const read = readPick(inner.conditions)
        if (!read || !read.pick.none || read.pick.ids.length === 0 || !take(read.field, read.pick)) return null
    }
    return model
}
