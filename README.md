# LaminarFlow — Frontend

Solid + TypeScript + Vite. Built with `npm run build` into `dist/`.

The Go API, schema, and migrations live in
[LaminarFlow-Backend](https://github.com/Willpatbarr/LaminarFlow-Backend).

## Same-origin deployment

In production the Go backend serves this bundle **and** the API from one origin
(LAM-28) — there is no separate frontend host. Application code should therefore
always use relative URLs (`fetch('/api/...')`), never an absolute backend URL.

`npm run dev` is the one place that is not literally true: Vite serves the app on
5173 while the backend listens on 8080. `vite.config.ts` proxies `/api` and
`/healthz` across so relative URLs work in dev too. Point `VITE_API_TARGET` at a
different backend if yours is not on 8080.

## Running it

Node is pinned in [.nvmrc](.nvmrc) — `nvm use` picks it up, and CI reads the
same file, so local and CI cannot drift.

    npm ci
    npm run dev

## Checks

`npm run build` type-checks with `tsc -b` before Vite emits the bundle, so a
type error fails the build rather than shipping.

    npm run lint
    npm test
    npm run test:e2e
    npm run build

## Consuming the API

    npm run api:pull

Fetches `api/openapi.json` from the backend's `main` and regenerates
`src/api/schema.d.ts`. Both are committed. Pass `API_REF=<branch>` to pull from
a branch that has not merged yet.

Calls go through `src/api/client.ts`, which is typed from the generated schema:
a path or field the backend does not have is a build error, not a 404.

## Routing

The route tree is declared in [src/router.tsx](src/router.tsx) with
`defineRoutes` from `@solidjs/router` — config routes, not the file-system
adapter. `defineRoutes` keeps the path literals, and those literals are what
type `router.paths`: a path the tree does not have is a compile error, not a
404.

The file-system adapter (`@solidjs/router/fs`) would generate the tree from
`src/routes/`, but its manifest needs a build step that ships with the Solid
CLI templates and SolidStart, and neither is installed here. Two routes do not
justify the integration. **Revisit when the route tree grows.**

Solid Router has no link component. Links are plain `<a href>` and the router
intercepts the click; it also sets `aria-current="page"` on the one matching the
URL.

### Protected routes

`/login` and `/signup` stand alone. Every other route is a child of the
pathless `AppLayout` (`routes/app.tsx`), which is the auth guard and the app
shell in one - so a route added under it is protected without having to
remember to be. Anonymous visitors are sent to `/login?returnTo=<where they
were going>`; `returnTo` passes through `safeReturnTo`
(`features/auth/returnTo.ts`), the only place it is trusted, and anything that
is not a same-origin path becomes `/`. While the session is still `unknown` the
shell renders with a placeholder rather than redirecting.

`createAppRouter(history?)` builds the real tree on any history adapter, which
is how the route tests start it at a given URL.

## Where components live

| Path | What belongs there |
| --- | --- |
| `src/routes/` | One file per URL. Thin — imports feature components, lays them out. |
| `src/features/<name>/` | One domain feature: its components, API calls, and state. |
| `src/components/ui/` | Domain-agnostic ui blocks used by more than one feature. |
| `src/sync/` | The local database, the sync engine and the reactive store over them. Not a feature: features read and write tickets through `@/sync`. |
| `e2e/` | Playwright specs — one per user-visible flow, not per component. |

Imports run one way — `routes/` → `features/` → `components/` — and **nothing
enforces it**. Solid has no compile-time module boundary the way Gradle modules
do in Kotlin, so a cross-feature import compiles happily. If that starts
happening, an import lint rule is the fix; there is deliberately none today.

## Local-first sync

IndexedDB is the source of truth for tickets. A user action is written there
first and the screen reads it back from there; the server hears about it
afterwards, in the background. `src/sync/` is three layers, each testable alone:

| File | What it is | Knows about |
| --- | --- | --- |
| `db.ts` | The IndexedDB schema and one write-transaction wrapper. | IndexedDB only. |
| `engine.ts` (+ `remote.ts`) | The rules: what an action writes, hydration, draining the outbox, what each HTTP answer means. | No Solid, no DOM. Its database, API client, clock and online status are arguments. |
| `store.ts` | A Solid store mirroring the database, plus the functions screens call. | Solid. |

`session.ts` is the one place this is tied to who is signed in, and `main.tsx`
calls it once: sync starts when the session becomes authenticated, stops when it
is not, and the database is **emptied on logout**. A database found on disk that
belongs to a different account is emptied at start.

**The model.** Two ticket tables: `server_tickets` is the server's copy, and
`tickets` is what the screen shows - always *the server's copy with that
ticket's outbox entries replayed on top*. A user action appends to (or amends)
the outbox and rebuilds the row; an answer from the server replaces the server's
copy, removes the entry and rebuilds the row. Nothing else writes a ticket row,
so a refresh cannot overwrite an unsent edit and a failed send never reverts
one.

**The outbox** is FIFO per ticket, one request at a time. Each update carries
`If-Match` with the version it was made on; an entry queued behind another gets
the version that one returns. An edit made while the previous one has not been
sent is folded into it.

| Answer | Entry becomes | Then |
| --- | --- | --- |
| 2xx | removed | The row takes the server's copy and version. |
| no response, 5xx | stays `pending` | Retried with capped exponential backoff (1s doubling to 60s), and at once when the browser comes back online. |
| 401 | `unauthorized` | Nothing at all is sent until `resume()`. |
| 409 | `conflict`, with the server's copy on it | That ticket's queue waits for `retry()` (mine wins) or `discard()`. Other tickets carry on. |
| 422, other 4xx | `failed`, with the `errors[]` | Waits for the user to change the edit, or `discard()`. |

A 409 that only says the server is already where the entry wanted it - an
archive of an archived ticket, or our own identical write whose response was
lost - is treated as the success it is.

**Temporary ids.** A ticket created offline has an id like `tmp_…` until the
server answers. At that point the engine renames it everywhere in one
transaction (row, and every queued entry for it), and the store renames the row
*in place* and remembers `old → new`. So the row keeps its identity: its DOM is
not rebuilt, a field being typed in keeps focus, and `ticketById` answers to
either id. The ticket page replaces its URL with the real one.

**Known limits.** Creating a ticket is not idempotent on the server, so a create
whose *response* is lost is sent again and makes a second ticket. Two tabs each
run their own engine over the same database and do not coordinate. Hydration
re-reads every list in full.

### `idb` rather than a hand-written wrapper

[`idb`](https://github.com/jakearchibald/idb) (pinned, about 1 kB gzipped, no
dependencies, no framework) turns IndexedDB's request events into promises and
types the schema. Writing that by hand is roughly the same code with more ways
to leave a transaction open by mistake, and nothing here needs behaviour `idb`
does not expose. It stays behind `db.ts`: nothing else imports it, so replacing
it is a one-file change. Tests run the same code against
[`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) (pinned,
dev-only).

## This repo never talks to Postgres

[scripts/check-no-db-driver.mjs](scripts/check-no-db-driver.mjs) fails
`npm run lint` if a database driver reaches the dependency tree. Every read and
write goes through the backend's HTTP API.

To see this repo's build served by the backend the way production does it, run
`./scripts/build-frontend.sh` in the backend repo.