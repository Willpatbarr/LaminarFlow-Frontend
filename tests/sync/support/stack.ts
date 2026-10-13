import createClient from 'openapi-fetch'

import type { paths } from '@/api/schema'

// Talking to the real backend from Node, as a person would from a browser: an
// account is a cookie. Node's fetch has no cookie jar, so this keeps one per
// account and attaches it itself.

export const SESSION_COOKIE = '__Host-laminar_session'

export function baseUrl(): string {
  const base = process.env.SYNC_BASE_URL
  if (!base) throw new Error('SYNC_BASE_URL is not set (globalSetup should have said so)')
  return base.replace(/\/$/, '')
}

let counter = 0
const run = Math.random().toString(36).slice(2, 8)

/** Unique per call, across test files and across runs against a long-lived stack. */
export function unique(label: string): string {
  return `${label}-${run}-${++counter}`
}

const PASSWORD = 'sync-test-password-1'

export type Account = {
  email: string
  displayName: string
  accountId: string
  workspaceId: string
  /** The current session's `name=value`, as the Cookie header carries it. */
  cookie: () => string
  /** Out-of-band logout: ends THIS session on the server, whatever the client holds. */
  logout(): Promise<void>
  /** Signs in again and swaps in the new session cookie. */
  login(): Promise<void>
  /** A typed client acting as this account, straight to the server (no engine). */
  api: ReturnType<typeof createClient<paths>>
}

function sessionFrom(response: Response): string {
  // getSetCookie keeps one entry per header, which a comma-joined get() would not.
  const header = response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`))
  if (!header) throw new Error(`no ${SESSION_COOKIE} in the response`)
  return header.split(';')[0]
}

/** Registers a new account (every one joins the same workspace) and signs it in. */
export async function newAccount(label = 'user'): Promise<Account> {
  const email = `${unique(label)}@sync.test`
  const displayName = unique(`Name ${label}`)
  const response = await fetch(`${baseUrl()}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, display_name: displayName }),
  })
  if (response.status !== 201) throw new Error(`register failed: ${response.status} ${await response.text()}`)
  const body = (await response.json()) as { account_id: string; workspace_id: string }
  let cookie = sessionFrom(response)

  const account: Account = {
    email,
    displayName,
    accountId: body.account_id,
    workspaceId: body.workspace_id,
    cookie: () => cookie,
    async logout() {
      const res = await fetch(`${baseUrl()}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
      if (!res.ok) throw new Error(`logout failed: ${res.status}`)
    },
    async login() {
      const res = await fetch(`${baseUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
      if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`)
      cookie = sessionFrom(res)
    },
    api: createClient<paths>({
      baseUrl: baseUrl(),
      fetch: (request) => {
        const headers = new Headers(request.headers)
        headers.set('Cookie', cookie)
        return fetch(new Request(request, { headers }))
      },
    }),
  }
  return account
}

type Data<T> = T extends { data?: infer D } ? NonNullable<D> : never

function must<T extends { data?: unknown; error?: unknown; response: Response }>(label: string, result: T): Data<T> {
  if (result.data === undefined) {
    throw new Error(`${label} failed: ${result.response.status} ${JSON.stringify(result.error)}`)
  }
  return result.data as Data<T>
}

export type World = {
  teamId: string
  projectId: string
  /** The team's statuses, in position order. */
  statusIds: string[]
}

/** A team and a project of the test's own. Tests share one workspace, so
 *  nothing is assumed about what else is in it. */
export async function newWorld(owner: Account): Promise<World> {
  const team = must(
    'create team',
    await owner.api.POST('/api/v1/teams', {
      body: { workspace_id: owner.workspaceId, name: unique('Team'), bare: false },
    }),
  )
  const project = must(
    'create project',
    await owner.api.POST('/api/v1/projects', { body: { team_id: team.id, name: unique('Project'), bare: false } }),
  )
  const statuses = [...(team.statuses ?? [])].sort((a, b) => a.position - b.position)
  return { teamId: team.id, projectId: project.id, statusIds: statuses.map((status) => status.id) }
}

// ── what "someone else, on another device" does, straight to the server ─────

export type Fields = {
  title: string
  description: string
  status_id: string | null
  assignee_id: string | null
}

export function fields(title: string, overrides: Partial<Fields> = {}): Fields {
  return { title, description: '', status_id: null, assignee_id: null, ...overrides }
}

export async function serverCreate(account: Account, projectId: string, f: Fields) {
  return must(
    'create ticket',
    await account.api.POST('/api/v1/tickets', { body: { project_id: projectId, ...f } }),
  )
}

export async function serverUpdate(account: Account, id: string, version: number, f: Fields) {
  return must(
    'update ticket',
    await account.api.PUT('/api/v1/tickets/{id}', {
      params: { path: { id }, header: { 'If-Match': `"${version}"` } },
      body: f,
    }),
  )
}

export async function serverArchive(account: Account, id: string, version: number) {
  const result = await account.api.DELETE('/api/v1/tickets/{id}', {
    params: { path: { id }, header: { 'If-Match': `"${version}"` } },
  })
  if (!result.response.ok) throw new Error(`archive failed: ${result.response.status} ${JSON.stringify(result.error)}`)
}

/** The server's live tickets in a project, every page, newest-created last. */
export async function serverTickets(account: Account, projectId: string) {
  const found = []
  let cursor: string | undefined
  for (;;) {
    const page = must(
      'list tickets',
      await account.api.POST('/api/v1/tickets/list', {
        body: { limit: 200, cursor, sort: [{ field: 'created_at', desc: false }] },
      }),
    )
    found.push(...(page.items ?? []).filter((ticket) => ticket.project_id === projectId))
    if (!page.has_more || !page.next_cursor) return found
    cursor = page.next_cursor
  }
}

export async function serverTicket(account: Account, id: string) {
  const result = await account.api.GET('/api/v1/tickets/{id}', { params: { path: { id } } })
  return result.data ?? null
}
