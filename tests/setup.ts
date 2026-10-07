import { afterEach } from 'vitest'
// Registers the jest-dom matchers on vitest's `expect` AND augments its types.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)
