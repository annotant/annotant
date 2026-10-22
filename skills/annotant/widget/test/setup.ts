import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without Vitest's globals, Testing Library cannot unmount by itself.
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
