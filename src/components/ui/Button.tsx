import type { ReactNode } from 'react'

// Domain-agnostic by construction: no ticket, document, or aspect appears in
// these props. That is the test for whether a component belongs in this folder.
type ButtonProps = {
    children: ReactNode
    onClick?: () => void
}

export function Button({ children, onClick }: ButtonProps) {
    return (
        <button type="button" className="button" onClick={onClick}>
            {children}
        </button>
    )
}
