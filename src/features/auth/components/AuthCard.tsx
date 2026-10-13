import type { JSX } from '@solidjs/web'

import './AuthCard.css'

type AuthCardProps = {
    title: string
    /** The other auth screen's link, below the card. */
    footer: JSX.Element
    onSubmit: (event: SubmitEvent) => void
    children: JSX.Element
}

// The page chrome login and sign-up share: a title, the specimen's card, and a
// way across to the other screen. The card is the <form>, so Enter submits from
// any field and the submit button needs no click handler.
export function AuthCard(props: AuthCardProps) {
    return (
        <div class="auth">
            <h1 class="t-screen-title">{props.title}</h1>
            {/* novalidate: the browser's own bubbles would replace our messages,
                and they look different in every browser. */}
            <form class="auth__card" novalidate onSubmit={props.onSubmit}>
                {props.children}
            </form>
            <p class="auth__switch t-body">{props.footer}</p>
        </div>
    )
}
