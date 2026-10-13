// Runs before every test file: registers the DOM matchers and guarantees each
// test starts against an empty document.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'

// Testing Library only registers its own cleanup when Vitest globals are on.
// They are off here, so unmounting is manual - without this, the second render
// in a file finds two copies of the component and every query throws.
afterEach(cleanup)

// jsdom does not implement scrolling, and the router asks for it on every
// navigation; without this each one prints a "not implemented" warning.
window.scrollTo = () => {}
