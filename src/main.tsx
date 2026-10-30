import { render } from '@solidjs/web'
import './index.css'
import { applyTheme } from '@/features/theme'
import { refresh, watchExpiredSession } from '@/features/auth'
import { connectSyncToSession } from '@/sync'
import { router as Router } from './router'

// The router instance is itself the provider component; the route tree, root
// layout included, lives in router.tsx. There is no type registration step -
// the tree's literal types flow through `router.paths` on their own.
// index.html already set the attribute before first paint; this keeps the
// browser-chrome colour in step and listens for the OS changing.
applyTheme()

render(() => <Router />, document.getElementById('root')!)

// The one place the local store is tied to the session: it starts syncing when
// someone is signed in, stops when they are not, and is wiped on logout.
connectSyncToSession()

// A "signed out" banner that is wrong (the 401 was a blip, or the user signed
// in in another tab) is re-checked when the tab or the network comes back.
watchExpiredSession()

// Ask the server who the cookie belongs to. Not awaited: the screen renders
// with status `unknown` and fills in when the answer lands. A failure (server
// down) leaves it `unknown` rather than claiming anonymous, so it is logged.
refresh().catch((error) => console.error('could not load the session', error))
