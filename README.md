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
    npm run build

`npm run test:sync` and `npm run test:e2e` are separate, need Docker, and run
against a real backend; see
[Testing against the real backend](#testing-against-the-real-backend) and
[End-to-end tests](#end-to-end-tests-playwright). The quickest way to run
either: `./scripts/test-stack.sh` (the sync suite) or `npm run test:e2e:stack`.

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
shell renders in its loading state rather than redirecting: the side nav and the
routed page each draw their own skeleton (see "Loading states" in
[src/components/README.md](src/components/README.md)). The layout renders the
page while the session is `unknown`, so a page under it must pass
`loading={session.status === 'unknown'}` to its container (or show nothing, as
the not-found page does).

`createAppRouter(history?)` builds the real tree on any history adapter, which
is how the route tests start it at a given URL.

## Where components live

| Path | What belongs there |
| --- | --- |
| `src/routes/` | One file per URL. Thin — imports feature components, lays them out. |
| `src/features/<name>/` | One domain feature: its components, API calls, and state. |
| `src/components/ui/` | Domain-agnostic ui blocks used by more than one feature. |
| `src/sync/` | The local database, the sync engine and the reactive store over them. Not a feature: features read and write tickets through `@/sync`. |
| `e2e/` | Playwright specs — one file per user-visible flow, not per component. They run against the real backend ([End-to-end tests](#end-to-end-tests-playwright)). |

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

**Any entity (LAM-125).** The engine carries every kind of thing through the
same path - tickets and documents today. An outbox entry names its `entity` and
its `entity_id`; order is kept per `entity_id`, so a parked document never holds
up a ticket. What differs per entity lives in one file in
`src/sync/entities/` that exports an `Entity`: its `rules` (which fields the
user edits, the row an unsent create shows, how to read a 409, the temporary-id
prefix) and its `remote` (list, send, read a change-feed frame). To add one
(comments, labels, epics, ...): add its row, fields, create and conflict types to
the maps in `types.ts`; a store pair in `db.ts` (and bump `DB_VERSION`); a file
in `entities/`; one line in `entities/index.ts`; and the `store.ts` wrappers its
screens call. The engine, the outbox, hydration and the change feed need no
change. Read the note at the top of `entities/document.ts` for what a new
endpoint has to give the client (an `Idempotency-Key`, a conflict body).

**Statuses (LAM-95)** are the third entity, and the one that differs most: the
server keeps no version for them, so `rules.unversioned` makes the engine apply
the `status.*` feed by upsert and remove instead of by version. A delete is an
`archive` entry whose payload says where the tickets go (`move_to`); a change of
`position` is sent as one reorder of the whole team's order (`entities/status.ts`).
`StatusEditor` (`features/tickets/components`) is the UI, takes a `teamId` and holds no
state of its own, so team settings (`/teams/:teamId/settings`) and the board's column
menu (LAM-107) mount the same component.

**The model.** Two ticket tables (and the same pair for every other entity): `server_tickets` is the server's copy, and
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
| no response, 5xx | stays `pending` | Retried with capped exponential backoff (1s doubling to 60s), and at once when the browser comes back online. While the browser says it is offline nothing is sent and no backoff grows. |
| 401 | `unauthorized` | Nothing at all is sent until `resume()` (or a new engine starts: a reload). |
| 409 | `conflict`, with the server's copy on it | That ticket's queue waits for `retry()` (mine wins), `discard()` or `keepAsNew()`. Other tickets carry on. |
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

**Creates are idempotent (LAM-76).** A `create` entry gets an `Idempotency-Key`
(`crypto.randomUUID()`) once, when it is queued, stored on the entry and sent on
every attempt. If a response is lost, the retry therefore reaches the server as
the same request and gets the ticket the first attempt made instead of a second
one. Coalescing an edit into a create that has not been sent keeps the key; a
create made from "Keep mine as a new ticket" is a new request and gets a new
one. The key survives a reload: IndexedDB is at version 2, and the upgrade gives
every `create` already waiting a key (one that had *already been sent* without
one cannot be matched to that attempt, so that single case can still duplicate).

A replay is reconciled exactly like a fresh answer: the temporary id is swapped
for the real one and the version comes from the response. The replay returns the
ticket as it is *now*, so it may already carry other people's edits; the row
takes those, and edits queued behind the create go out on the version it
returned. (An edit is not folded into a create that was sent and went
unanswered, because the server ignores the body of a replay.) If someone has
archived the ticket since, the replay is `409 ticket_archived`: that means the
create did land, so with nothing queued behind it the entry and the local row are
simply dropped, and with edits queued behind it they become the ordinary
"archived underneath you" conflict on the real ticket, whose panel offers "Keep
mine as a new ticket".

**Known limits.** **Two tabs each run their own engine over the same database
and are not coordinated** - there is no lock or leader election, so both may send
the same entry (the key makes that harmless for a create; an edit sent twice
meets the server's version check). Hydration
re-reads every list in full.

### Live changes (the WebSocket)

`GET /api/v1/ws` pushes a frame whenever a ticket in the workspace is created,
edited, archived or restored (contract: the backend's `docs/realtime.md`).
`socket.ts` is the transport and knows nothing of tickets; `engine.applyRemote`
is what a frame means. `store.ts` owns one socket per running engine and joins
them.

- **Apply by version.** A frame is applied only if its `version` is newer than
  the server's copy we hold; the echo of our own write and an out-of-order older
  frame are therefore ignored. An archive removes the ticket and remembers the
  version it happened at, so an older frame arriving after it cannot bring the
  ticket back. Unknown types and malformed frames are ignored.
- **Same worker.** `applyRemote` queues; the engine's worker applies the queue
  between requests and after a hydration, never during one. A frame that arrives
  while a list is on the wire is applied on top of the list, and one that
  arrives while a create is on the wire waits for the answer so the ticket is
  not shown twice.
- **Unsent changes win on screen.** For a ticket with outbox entries only the
  server's copy moves (the same rule hydration follows), so a later `discard()`
  goes back to the newest state. The entries' base versions are left alone: a
  stale base must still reach the server and come back as the 409.
- **Live only after `hello`.** An open socket is not a working one. A socket
  that has not said hello in 10 seconds is dropped and retried.
- **Offline is the browser's word.** The `offline` event closes the socket on
  purpose and shows Offline at once; an open socket proves nothing about the
  network (a half-open connection looks open for minutes, and Chromium's offline
  mode leaves an established one standing). `online` reconnects. The connectivity
  dependency the engine and the socket share has `onOnline`/`onOffline`; the
  socket still has no `window` in it.
- **Reconnecting.** Capped exponential backoff (1s doubling to 30s) with
  jitter, and at once on `online` and when the tab is shown again. Every
  successful (re)connect lists again, because there is no replay, except the
  first `hello` while the first list is still running. Nothing reconnects while
  the engine is paused for a 401; `resume()` brings the socket back.
- **The client never sends.** A data frame closes the connection (1008), and the
  server's 30-second pings are answered by the browser out of sight of JS, so
  there is no heartbeat: liveness is the close and error events plus the two
  triggers above.
- `sync.connection` is `connecting | live | reconnecting | offline`; the side nav
  shows it (`ConnectionIndicator`, a polite status region, quiet when live).
- In dev, `vite.config.ts` proxies `/api/v1/ws` with `ws: true` and without
  `changeOrigin`, because the server refuses an upgrade whose `Origin` host is
  not its `Host`.

### Failures (LAM-70)

`src/api/errors.ts` is the one place a status code is read: `classify()` maps an
answer (or a thrown error) to `validation | unauthorized | forbidden | not_found |
conflict | server | network | rejected`, and `npm run lint` fails if another
module compares a status to a number. 408/425/429 count as `server` (retry later),
400/422 as `validation`, any other 4xx as `rejected`, and anything that is not an
API answer as `network`.

- **Session ends mid-action.** A 401 from a send or a list pauses the engine;
  `sync/session.ts` turns that into `session.expired` (status stays
  `authenticated`, so the route guard does nothing). `SessionExpiredBanner`
  (auth feature) asks for a sign-in in place. Same account: `resumeFor()` sends
  what waited. Different account: `startSync` empties the old database, and the
  old engine stayed paused throughout so none of it is sent. A visitor who
  arrives with no session is `anonymous` and is redirected as before; their
  unsynced work stays on disk and is sent after signing in as the same account
  (a new engine un-parks `unauthorized` entries).
- **A banner that is wrong.** While `session.expired` is set, the tab coming
  back to the front and the network coming back each ask `/auth/me` once
  (`watchExpiredSession`, started in `main.tsx`; no timer). 200 clears the flag as
  a sign-in does - the same account resumes what was parked, another account takes
  the different-account path above - and 401 or no answer leaves the banner.
- **Length limits.** The server's limits (ticket title 200, description 50,000,
  team and project names 100, counted in code points) are written once in
  `features/tickets/limits.ts`, and `limits.test.ts` fails if they drift from
  `maxLength` in `api/openapi.json`. The field shows "212 / 200" once it is
  within 10% of the limit; over it the field is marked invalid with the reason.
  Nothing is cut off (no `maxlength`, which silently drops pasted text) and
  nothing over the limit or blank is queued: the text stays in the field. The
  server's 422 is still the authority and still lands on the field, and
  `status_not_found` / `assignee_not_found` land on the status and assignee
  controls. An over-limit draft lives in the field only; it is not kept if the
  page is left.
- **Server or network down.** `syncTrouble()` (derived, not per attempt) drives
  one dismissible toast with "Retry now" (`retryNow()` skips every backoff).
- **Refused changes** park as `failed`. The ticket page shows each
  `errors[].location` at its field (`tickets/entryFailure.ts`); editing a field
  folds into the failed entry and sends again, "Discard my change" drops it.
- **Conflicts** (LAM-71) are a decision, not a fault: the ticket page shows a
  `ConflictPanel` (a labelled region, neutral colours) with the sentence built
  from the 409 (who, edited or archived, how long ago), both versions field by
  field where they differ, and the way out: `discard()` ("Keep theirs"),
  `retry()` ("Use mine", edits only), or `keepAsNew()`, which in one transaction
  queues a `create` of the user's version (later edits behind the conflict
  included, same project, title untouched) and then resolves the original as
  `discard()` does. The ticket's fields are read-only until it is decided.
- **A parked archive keeps its row.** An archive hides the row only while
  nothing in that ticket's queue is waiting for a person (`rebuild` in the
  engine); once the archive, or an edit ahead of it, is `failed` or `conflict`,
  the row is shown again so the page can say so, and `archiveOnHold(id)` tells a
  list the row is there for that reason. Nothing more can be queued on it.
- **Pending indicator** in the side nav foot (`pendingSummary()`); logout asks
  first when `unsyncedCount() > 0`. `failed` entries read "needs attention",
  `conflict` entries "need a decision" (`reason: 'decision'`, a blue dot), worded
  in `features/syncstatus/components/PendingChanges.tsx`.

### `idb` rather than a hand-written wrapper

[`idb`](https://github.com/jakearchibald/idb) (pinned, about 1 kB gzipped, no
dependencies, no framework) turns IndexedDB's request events into promises and
types the schema. Writing that by hand is roughly the same code with more ways
to leave a transaction open by mistake, and nothing here needs behaviour `idb`
does not expose. It stays behind `db.ts`: nothing else imports it, so replacing
it is a one-file change. Tests run the same code against
[`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) (pinned,
dev-only).

## Testing against the real backend

The sync unit tests stub `fetch` and fake the socket, so they prove the engine
agrees with itself. A reconciliation bug loses data silently, which is why there
is a second suite that runs the **real** `src/sync` engine, database layer and
socket against the **real** Go backend and a real Postgres (LAM-72).

    ./scripts/test-stack.sh          # build, start, wait healthy, run the suite, always tear down

That builds the backend's own image (its `Dockerfile` bakes this checkout in as
the frontend, via a named build context), starts it with a throwaway
`postgres:17`, applies migrations on startup, runs `npm run test:sync` with
`SYNC_BASE_URL` pointing at it, and removes the containers and network whether
the run passed or not. Postgres keeps its data on a tmpfs and publishes no port,
so nothing survives a run. The first build is slow (it pulls the Node, Go and
Postgres images and compiles both repos); later ones reuse the layer cache.

| | |
| --- | --- |
| `scripts/test-stack.sh up` | start the stack and leave it running; prints `export SYNC_BASE_URL=...` |
| `npm run test:sync` | the suite alone, against whatever `SYNC_BASE_URL` names (iterate with this after `up`) |
| `scripts/test-stack.sh down` | tear it down |
| `scripts/test-stack.sh -- <cmd>` | the same stack, running `<cmd>` instead |

`npm run test:sync` **fails, it does not skip,** when `SYNC_BASE_URL` is unset
or the backend does not answer `/healthz/db`. It is its own Vitest config
(`vitest.sync.config.ts`, files `tests/sync/**/*.sync.test.ts`) and is not part
of `npm test`.

Settings, all optional: `STACK_PORT` (host port, loopback only, default `18180`
- not 8080 or 5173, which a dev server is likely to hold), `STACK_PROJECT`
(compose project name, default `lf-sync-test`), `BACKEND_DIR` (a backend
checkout; default `../LaminarFlow-Backend` if it exists, otherwise the backend is
cloned at the ref into `.backend-checkout`), `BACKEND_REF`, `KEEP_STACK=1`
(leave it up afterwards).

**Which backend.** `.backend-ref` is one line naming the backend branch or tag to
test against; `BACKEND_REF` overrides it. CI checks that ref out; a local run
uses your sibling checkout as it stands and warns if it is on a different branch.
The file names the integration branch only because the backend's endpoint pull
requests are not merged yet. **Once they are, it goes back to `main`.**

**What it covers.** A create whose response is lost and is retried yielding one
ticket, the same key on every attempt and across an engine restart, a replay
after another account edited the ticket (reconciled to the edited state) or
archived it ("created, then archived", and the parked variant with "Keep mine as
new" under a new key), the length limits in code points and the two named-id
refusals at their fields. Create and update reconciling to the server's id and
version (and `If-Match` being sent); two edits queued behind each other; a
create followed by an edit before the create is answered; archive; offline then
drain, both as the browser's `offline` event and as a dead network; a stale
edit parked as a `conflict` with the server's copy and who changed it and when;
an edit to a ticket archived underneath (`ticket_archived`); retry, discard and
keep-as-new on a real conflict; another account's change arriving over a real
WebSocket and landing in the local store; this client's own echo not
double-applying; an expired session parking as `unauthorized` and resuming
after sign-in; hydration paging past one page and removing a ticket archived
elsewhere; re-listing after a dropped socket.

**What it does not cover.** There is no browser: no Solid, no components, no
router, no `connectSyncToSession`. IndexedDB is `fake-indexeddb`, so a real
browser's storage limits, eviction and transaction timing are not exercised.
The socket is the `ws` package with the cookie and `Origin` a browser would send,
not a browser's WebSocket (which also answers pings out of sight of JS).
Cookies are carried by hand because Node's `fetch` has no jar, so `Secure` /
`SameSite` behaviour is not tested. The proxy in front of production, if any, is
not there. Whole-app flows are the Playwright suite's job (next section).

Each test registers its own accounts and builds its own team and project, because
every account joins the same single workspace; assertions are only ever about a
test's own tickets.

## End-to-end tests (Playwright)

`e2e/` drives the whole app in a real Chromium against the same disposable stack
as the sync suite (LAM-73): the Go backend serving this repo's built bundle
same-origin on a throwaway Postgres, the way production serves it. Nothing is
mocked and there is no Vite dev server, so a session cookie, a WebSocket
upgrade and a login redirect are exercised for real.

    npm run test:e2e:stack      # build the stack, run every spec, always tear it down

That is `scripts/test-stack.sh -- npm run test:e2e`. To iterate, leave a stack up
and point the specs at it:

    scripts/test-stack.sh up                       # prints the export line
    export SYNC_BASE_URL=http://127.0.0.1:18180
    npm run test:e2e                               # all specs
    npx playwright test e2e/07-conflict.spec.ts    # one file
    npx playwright test --ui                       # Playwright's watch UI
    scripts/test-stack.sh down

The stack's image is built from a copy of this working tree, so **rebuild it
(`down`, then `up`) after changing `src/`**; a stack left running serves the
bundle it was built with. `npm run test:e2e` **fails with a message** when
neither `E2E_BASE_URL` nor `SYNC_BASE_URL` is set or nothing answers there; it
never skips. `E2E_BASE_URL` takes precedence if you have a backend of your own.

**Every user-visible feature comes with a spec** (or a new test in the spec for
its flow), the way it comes with unit tests. The unit tests prove a component
does what it was written to do; the spec proves a person can still get through
the flow with the real server, cookie and socket in the way. A change that
alters a flow changes its spec in the same commit.

**Conventions**

- **Locators are roles and labels** (`getByRole`, `getByLabel`), never CSS or
  test ids. If a control cannot be found that way, a screen reader cannot find
  it either: fix the markup, do not add a test id.
- **Wait on visible state, never on time.** There are no `waitForTimeout`s;
  assertions retry until the page says what is expected. Remember the loading
  placeholders have the same headings as the loaded page (`listLoaded`).
- **Each spec makes its own accounts** and its own team and project on the
  server (`e2e/support/app.ts`, over the sync suite's `tests/sync/support/stack.ts`),
  then signs the browser in by handing it the account's session cookie. All
  accounts share ONE workspace, so a spec selects its own project in the
  picker and only asserts about its own tickets. Only the first account in a
  fresh database sees the first-run "Set up your first team" form; the files are
  numbered so `01-sign-up` runs first and covers it on a fresh stack.
- **State that is not the point of a spec is arranged server-side**; "someone else
  edits this ticket" is a `serverUpdate` as another account, not a second browser.
- One worker, no retries: a spec that needs a second try is flaky, and a retry
  would hide it.
- `context.setOffline()` stops requests and fires the page's `offline` event but
  leaves an open WebSocket standing (the app closes it itself on the event), so a
  ticket's copy is made stale with `cuttableSocket(page)` (closes the socket and
  refuses reconnects) instead.

**Specs**

| File | Flow |
| --- | --- |
| `01-sign-up` | sign up (and the first-run form when it appears), still signed in after a reload; a taken email |
| `02-log-out-and-in` | log out ends the session, log back in; a wrong password |
| `03-deep-link` | an anonymous link to a ticket goes to login and returns to that ticket |
| `04-create-ticket` | create a ticket, see it under its status with a real id, reload |
| `05-live-changes` | a second browser, another account: edits, creates and archives arrive over the WebSocket |
| `06-offline` | edit and create offline, the pending indicator, sync on return; going offline flips the connection indicator at once |
| `07-conflict` | a stale edit: the panel names the other person; keep mine as new, keep theirs, use mine |
| `08-session-expired` | the session ends mid-edit: banner in place, sign in from it, the edit syncs |
| `09-validation` | a title over 200 characters is explained at the field and not queued; the server's own 422 still lands there when the client check is bypassed (the 1 MiB `413` is a unit test now) |
| `10-accessibility` | axe-core scan of login, sign-up, list, ticket page and conflict panel, light and dark |

The scan fails on serious and critical violations and attaches the rest to the
report; nothing is excluded. It catches contrast, names and ARIA misuse, not
whether a screen *works* with a keyboard or a screen reader.

**Reading a failure.** A failed spec keeps a trace (`trace: 'retain-on-failure'`),
a recording of every action with DOM snapshots, network and console:

    npx playwright show-trace test-results/<spec-folder>/trace.zip
    npx playwright show-report            # the HTML report, with the traces attached

A spec that opens a second browser context has both in the one `trace.zip`
(the viewer lists each page). In CI the
`e2e` job uploads `playwright-report/` and `test-results/` as the
`playwright-failure` artifact when it fails: download it, unzip, and open the
`trace.zip` the same way (or drop it on <https://trace.playwright.dev>).

**Not covered.** Chromium only; a desktop viewport; the IndexedDB limits and
eviction of a real device; a real network drop (see the offline note above).

## This repo never talks to Postgres

[scripts/check-no-db-driver.mjs](scripts/check-no-db-driver.mjs) fails
`npm run lint` if a database driver reaches the dependency tree. Every read and
write goes through the backend's HTTP API.

To see this repo's build served by the backend the way production does it, run
`./scripts/build-frontend.sh` in the backend repo.