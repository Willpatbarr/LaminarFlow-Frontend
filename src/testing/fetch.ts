import { vi } from 'vitest'

// Network doubles for component tests. The app is tested at `fetch`, not at the
// api client, so what runs is the same code path production does: the typed
// client builds a real Request, and these answer it.
//
// Keys are "METHOD /path". A request nobody stubbed fails the test loudly
// rather than returning something plausible.
type Handler = (request: Request) => Response | Promise<Response>

export function stubFetch(routes: Record<string, Handler>) {
    const fetchMock = vi.fn(async (request: Request) => {
        const key = `${request.method} ${new URL(request.url).pathname}`
        const handler = routes[key]
        if (!handler) throw new Error(`unstubbed request: ${key}`)
        return handler(request)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

export function ok(body: unknown, status = 200) {
    return Response.json(body, { status })
}

// A problem document in the backend's envelope (docs/api-errors.md).
export function problem(
    status: number,
    code: string,
    errors?: { location: string; message: string }[],
) {
    return new Response(JSON.stringify({ title: 'Error', status, code, errors }), {
        status,
        headers: { 'Content-Type': 'application/problem+json' },
    })
}

// The body a request carried. Clones first so the handler's own read, if any,
// still works.
export async function bodyOf(request: Request) {
    return request.clone().json()
}
