import { render } from '@solidjs/web'
import './index.css'
import { router as Router } from './router'

// The router instance is itself the provider component; the route tree, root
// layout included, lives in router.tsx. There is no type registration step -
// the tree's literal types flow through `router.paths` on their own.
render(() => <Router />, document.getElementById('root')!)
