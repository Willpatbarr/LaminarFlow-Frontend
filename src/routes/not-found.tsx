// A URL no route claims. It sits inside the guard so that an anonymous user at
// a URL the app does not know yet still goes to /login first, instead of
// getting a blank page that reveals nothing and fixes nothing.
export function NotFoundPage() {
    return (
        <section>
            <h1 class="t-page-title">Page not found</h1>
            <p class="t-body">
                There is nothing at this address. <a href="/">Back to tickets</a>
            </p>
        </section>
    )
}
