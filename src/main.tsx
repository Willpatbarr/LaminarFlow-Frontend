import { render } from '@solidjs/web'
import './index.css'
import { refresh } from '@/features/auth'
import { router as Router } from './router'

// The router instance is itself the provider component; the route tree, root
// layout included, lives in router.tsx. There is no type registration step -
// the tree's literal types flow through `router.paths` on their own.
render(() => <Router />, document.getElementById('root')!)

// Ask the server who the cookie belongs to. Not awaited: the screen renders
// with status `unknown` and fills in when the answer lands. A failure (server
// down) leaves it `unknown` rather than claiming anonymous, so it is logged.
refresh().catch((error) => console.error('could not load the session', error))
