import { createRouter, defineRoutes } from '@solidjs/router'

import { RootLayout } from '@/routes/__root'
import { HomePage } from '@/routes/index'
import { LoginPage } from '@/routes/login'
import { SignUpPage } from '@/routes/signup'

// Config routes, not the file-system adapter - see "Routing" in the README.
// `defineRoutes` keeps the path literals, and the literals are what type
// `router.paths`, so a path the tree does not have is a compile error instead
// of a 404 at runtime.
const routes = defineRoutes([
    {
        // Pathless: the layout wraps every route below without owning a URL.
        component: RootLayout,
        children: [
            { path: '/', component: HomePage },
            { path: '/login', component: LoginPage },
            { path: '/signup', component: SignUpPage },
        ],
    },
])

export const router = createRouter({ routes })
