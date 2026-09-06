import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import './index.css'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

    // Registers the route tree with the library's types, which is what makes
    // <Link to="/nope"> a compile error instead of a 404 at runtime.
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
        }
    }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <RouterProvider router={router} />
  </StrictMode>,
)
