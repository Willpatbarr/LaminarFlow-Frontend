import type { components } from '@/api/schema'

/*
┌─ tickets/listView ──────────────────────────────
│  ListViewConfig: the list's filter, group, sort and columns - the saved view `config` shape (LAM-86)
├─ out ───────────────────────────────────────────
│      ListViewConfig, FilterGroup, FilterCondition, SortKey
│      FIELDS, COLUMN_FIELDS, GROUP_FIELDS, DEFAULT_COLUMNS, fieldLabel, kindOf
│      DEFAULT_GROUP, normalize, visibleColumns, toSearch, fromSearch
├─ example ───────────────────────────────────────
│      ?filter={"op":"and","conditions":[…]}&sort=title,updated_at:desc&group=epic&columns=title,status
*/
// The list's whole view state is ONE value, and it is the backend's saved view
// `config` (schema `Config`) with nothing added: `filter` is the filter
// language of POST /tickets/list, `group` is a ticket field name, `sort` is a
// list of { field, desc } and `columns` is a list of field names. Saving a view
// (LAM-118) is `body.config = config`, and opening one is handing its config
// back to the list - there is no translation in either direction.
//
// Every name is the backend's ticket vocabulary (internal/ticket/fields.go),
// never a UI word: "status" not "state", "label" not "labels".
//
// Where the config lives is the URL: the list reads it from the search params
// on every render and writes it back on every change, so a link reproduces the
// view and a reload keeps it. That codec is here too. Nothing here is personal
// data: field names, option ids (opaque uuids) and the text a person typed
// into the title filter. Collapsed groups are not part of the config (a saved
// view should not remember which groups were folded); the list keeps them in
// their own `collapsed` param.

export type FilterGroup = components['schemas']['Group']
export type FilterCondition = components['schemas']['Condition']
export type SortKey = components['schemas']['Order']
export type ListViewConfig = {
    filter?: FilterGroup
    group?: string
    sort?: SortKey[]
    columns?: string[]
}

type Kind = 'text' | 'uuid' | 'time' | 'number' | 'uuid_set'

type Field = {
    kind: Kind
    label: string
    /** The grid track this column takes, when it is shown. */
    width: string
}

/** The backend's ticket filter vocabulary, with the kind that decides which
 *  operators are legal (internal/filter/filter.go). */
export const FIELDS: Record<string, Field> = {
    title: { kind: 'text', label: 'Title', width: 'minmax(0, 1fr)' },
    description: { kind: 'text', label: 'Description', width: '160px' },
    project: { kind: 'uuid', label: 'Project', width: '120px' },
    status: { kind: 'uuid', label: 'Status', width: '132px' },
    assignee: { kind: 'uuid', label: 'Assignee', width: '72px' },
    epic: { kind: 'uuid', label: 'Epic', width: '120px' },
    milestone: { kind: 'uuid', label: 'Milestone', width: '110px' },
    created_at: { kind: 'time', label: 'Created', width: '96px' },
    updated_at: { kind: 'time', label: 'Updated', width: '96px' },
    version: { kind: 'number', label: 'Version', width: '64px' },
    position: { kind: 'number', label: 'Position', width: '72px' },
    label: { kind: 'uuid_set', label: 'Labels', width: '150px' },
    sprint: { kind: 'uuid_set', label: 'Sprint', width: '110px' },
}

/** The fields the list can show as a column, and so can sort by. */
export const COLUMN_FIELDS = [
    'title',
    'status',
    'assignee',
    'epic',
    'milestone',
    'label',
    'sprint',
    'updated_at',
    'position',
] as const

/** What the list can group by. Not `label` or `sprint`: a ticket has many of
 *  each, and the backend refuses to save a view grouped by a multi-valued field
 *  (savedview Config.Validate), so offering it would build a view that cannot
 *  be saved. */
export const GROUP_FIELDS = ['status', 'assignee', 'epic', 'milestone'] as const

/** What the list shows until someone chooses: today's layout. */
export const DEFAULT_COLUMNS: readonly string[] = ['title', 'status', 'assignee']

export const fieldLabel = (field: string) => FIELDS[field]?.label ?? field
export const kindOf = (field: string): Kind | undefined => FIELDS[field]?.kind

/** What a link with no `group` shows: the list has always been grouped by
 *  status. A config with NO group is ungrouped (the saved view meaning), so the
 *  URL says that out loud as `group=none` rather than leaving it blank. */
export const DEFAULT_GROUP = 'status'

const LEGAL: Record<Kind, readonly string[]> = {
    text: ['eq', 'neq', 'contains', 'in', 'is_null', 'is_not_null'],
    uuid: ['eq', 'neq', 'in', 'is_null', 'is_not_null'],
    time: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'is_not_null'],
    uuid_set: ['eq', 'neq', 'in', 'is_null', 'is_not_null'],
}

// The backend's own bounds (internal/filter/filter.go), so a URL that would be
// refused there is dropped here instead of sent.
const MAX_DEPTH = 5
const MAX_CONDITIONS = 100
const MAX_FILTER_CHARS = 4000

/** A config without its empty parts: no filter that filters nothing, no empty
 *  sort or columns. What is saved and what is put in the URL. */
export function normalize(config: ListViewConfig): ListViewConfig {
    const out: ListViewConfig = {}
    if (config.filter && countConditions(config.filter) > 0) out.filter = config.filter
    if (config.group) out.group = config.group
    if (config.sort && config.sort.length > 0) out.sort = config.sort
    if (config.columns && config.columns.length > 0) out.columns = config.columns
    return out
}

function countConditions(group: FilterGroup): number {
    return (
        (group.conditions?.length ?? 0) +
        (group.groups ?? []).reduce((total, inner) => total + countConditions(inner), 0)
    )
}

/** The columns to draw, in order. Title is always first and always there: the
 *  row is a link on it. */
export function visibleColumns(config: ListViewConfig): string[] {
    const chosen = (config.columns ?? DEFAULT_COLUMNS).filter(
        (field) => field !== 'title' && (COLUMN_FIELDS as readonly string[]).includes(field),
    )
    return ['title', ...chosen]
}

// ---------------------------------------------------------------- the URL

/** The params this view owns. Anything else in the query (`ticket`) is the
 *  list's, and is left alone. */
export const VIEW_PARAMS = ['filter', 'group', 'sort', 'columns', 'collapsed'] as const

export function toSearch(config: ListViewConfig, collapsed: readonly string[] = []): URLSearchParams {
    const params = new URLSearchParams()
    const view = normalize(config)
    if (view.filter) params.set('filter', JSON.stringify(view.filter))
    if (view.group === undefined) params.set('group', 'none')
    else if (view.group !== DEFAULT_GROUP) params.set('group', view.group)
    if (view.sort) params.set('sort', view.sort.map((key) => (key.desc ? `${key.field}:desc` : key.field)).join(','))
    if (view.columns) params.set('columns', view.columns.join(','))
    if (collapsed.length > 0) params.set('collapsed', collapsed.join(','))
    return params
}

/** The config a URL describes. Anything that is not valid is dropped rather
 *  than trusted: a hand-edited or stale link degrades to a plainer view, it
 *  never breaks the page or sends the server a request it would refuse. */
export function fromSearch(params: URLSearchParams): { config: ListViewConfig; collapsed: string[] } {
    const config: ListViewConfig = {}

    const filter = parseFilter(params.get('filter'))
    if (filter) config.filter = filter

    const group = params.get('group')
    if (group === null || !(group === 'none' || (GROUP_FIELDS as readonly string[]).includes(group)))
        config.group = DEFAULT_GROUP
    else if (group !== 'none') config.group = group

    const sort = (params.get('sort') ?? '')
        .split(',')
        .map((part): SortKey | null => {
            const [field, direction, ...rest] = part.split(':')
            if (!FIELDS[field] || rest.length > 0 || (direction !== undefined && direction !== 'desc')) return null
            return { field, desc: direction === 'desc' }
        })
        .filter((key): key is SortKey => key !== null)
    // LAM-155: "Recently updated" and "Updated" were one ordering listed twice.
    // The list's own order (no sort) is newest change first, which is what
    // `updated_at:desc` says, so an old link or saved view that names it means
    // the default. (`updated_at` ascending stays: it is the same option with
    // its direction flipped.)
    if (sort.length > 0 && !isRecentlyUpdated(sort)) config.sort = sort

    const seen = new Set<string>()
    const columns = (params.get('columns') ?? '')
        .split(',')
        .filter(
            (field) => (COLUMN_FIELDS as readonly string[]).includes(field) && !seen.has(field) && !!seen.add(field),
        )
    if (columns.length > 0) config.columns = columns

    const collapsed = (params.get('collapsed') ?? '').split(',').filter((key) => key !== '')
    return { config, collapsed }
}

const isRecentlyUpdated = (sort: SortKey[]) => sort.length === 1 && sort[0].field === 'updated_at' && sort[0].desc

function parseFilter(raw: string | null): FilterGroup | undefined {
    if (!raw || raw.length > MAX_FILTER_CHARS) return undefined
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return undefined
    }
    const budget = { conditions: 0 }
    const group = validGroup(value, 1, budget)
    return group && countConditions(group) > 0 ? group : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

function validGroup(value: unknown, depth: number, budget: { conditions: number }): FilterGroup | null {
    if (!isRecord(value) || depth > MAX_DEPTH) return null
    if (value.op !== 'and' && value.op !== 'or') return null
    const group: FilterGroup = { op: value.op }
    if (value.conditions !== undefined) {
        if (!Array.isArray(value.conditions)) return null
        const conditions: FilterCondition[] = []
        for (const raw of value.conditions) {
            const condition = validCondition(raw)
            if (!condition || ++budget.conditions > MAX_CONDITIONS) return null
            conditions.push(condition)
        }
        if (conditions.length > 0) group.conditions = conditions
    }
    if (value.groups !== undefined) {
        if (!Array.isArray(value.groups)) return null
        const groups: FilterGroup[] = []
        for (const raw of value.groups) {
            const inner = validGroup(raw, depth + 1, budget)
            if (!inner) return null
            groups.push(inner)
        }
        if (groups.length > 0) group.groups = groups
    }
    return group
}

const isScalar = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number'

function validCondition(value: unknown): FilterCondition | null {
    if (!isRecord(value) || typeof value.field !== 'string' || typeof value.op !== 'string') return null
    const kind = kindOf(value.field)
    if (!kind || !LEGAL[kind].includes(value.op)) return null
    if (value.op === 'is_null' || value.op === 'is_not_null') return { field: value.field, op: value.op }
    if (value.op === 'in') {
        if (!Array.isArray(value.value) || value.value.length === 0 || !value.value.every(isScalar)) return null
        return { field: value.field, op: value.op, value: value.value }
    }
    if (!isScalar(value.value)) return null
    return { field: value.field, op: value.op, value: value.value }
}
