// Runs before every test file: registers the DOM matchers and guarantees each
// test starts against an empty document.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only registers its own cleanup when Vitest globals are on.
// They are off here, so unmounting is manual - without this, the second render
// in a file finds two copies of the component and every query throws.
afterEach(cleanup)
