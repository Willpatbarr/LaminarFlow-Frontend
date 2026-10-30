/*
┌─ documents ─────────────────────────────────────
│  projectFilter: the /documents project filter, kept in the address (LAM-170)
├─ out ───────────────────────────────────────────
│      PROJECT_PARAM, NO_PROJECT
│      projectFilterOf(search)              the filter value: '' (all), NO_PROJECT, or a project id
│      withProjectFilter(search, value)     the query string with the filter set (or dropped)
│      filteredProjectId(search)            the project id alone, or null
├─ example ───────────────────────────────────────
│      /documents?project=<uuid>   or   /documents?project=none
*/
// Like the ticket list's view (listView/config.ts), the filter is data in the
// URL: a reload keeps it, a link reproduces it, and the command palette, which
// sits outside the page, can read it to file "New document" under the same
// project as the page's own button does.
export const PROJECT_PARAM = 'project'
export const NO_PROJECT = 'none'

export function projectFilterOf(search: string): string {
    return new URLSearchParams(search).get(PROJECT_PARAM) ?? ''
}

export function filteredProjectId(search: string): string | null {
    const value = projectFilterOf(search)
    return value === '' || value === NO_PROJECT ? null : value
}

/** The query string (with its `?`, or empty) after setting the filter; other params stay. */
export function withProjectFilter(search: string, value: string): string {
    const params = new URLSearchParams(search)
    if (value === '') params.delete(PROJECT_PARAM)
    else params.set(PROJECT_PARAM, value)
    const query = params.toString()
    return query ? `?${query}` : ''
}
