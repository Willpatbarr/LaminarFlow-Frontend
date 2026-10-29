import { createRouter, defineRoutes, type RouterHistory } from '@solidjs/router'

import { AppLayout } from '@/routes/app'
import { HomePage } from '@/routes/index'
import { DocumentPage, DocumentsPage } from '@/routes/documents'
import { LoginPage } from '@/routes/login'
import { NotFoundPage } from '@/routes/not-found'
import { ProjectPage } from '@/routes/project'
import { SignUpPage } from '@/routes/signup'
import { TeamPage } from '@/routes/team'
import { TeamSettingsPage } from '@/routes/team-settings'
import { TicketPage } from '@/routes/ticket'
import { ViewPage, ViewsPage } from '@/routes/views'

// Config routes, not the file-system adapter - see "Routing" in the README.
// `defineRoutes` keeps the path literals, and the literals are what type
// `router.paths`, so a path the tree does not have is a compile error instead
// of a 404 at runtime.
//
// Two groups. Login and sign-up stand alone. Everything else is a child of the
// pathless AppLayout, which is the auth guard and the app shell in one: a
// route added there is protected without having to remember to be.
const routes = defineRoutes([
    { path: '/login', component: LoginPage },
    { path: '/signup', component: SignUpPage },
    {
        component: AppLayout,
        children: [
            { path: '/', component: HomePage },
            { path: '/tickets/:id', component: TicketPage },
            { path: '/teams/:teamId', component: TeamPage },
            { path: '/teams/:teamId/settings', component: TeamSettingsPage },
            { path: '/projects/:projectId', component: ProjectPage },
            { path: '/documents', component: DocumentsPage },
            { path: '/documents/:id', component: DocumentPage },
            { path: '/views', component: ViewsPage },
            { path: '/views/:id', component: ViewPage },
            // Last, so it only catches what nothing above matched.
            { path: '*', component: NotFoundPage },
        ],
    },
])

// A function so tests can start the real tree at any URL with a memory history.
export function createAppRouter(history?: RouterHistory) {
    return createRouter({ routes, history })
}

export const router = createAppRouter()
