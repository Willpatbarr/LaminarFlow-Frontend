import { Link, Outlet, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
    return (
        <>
            <nav>
                <Link to="/">LaminarFlow</Link>
            </nav>
            <main>
                <Outlet />
            </main>
        </>
    )
}