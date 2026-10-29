import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// happy-dom paints nothing, so hits nothing: a spec that lays the page out says what.
if (!('elementsFromPoint' in Document.prototype))
  Object.defineProperty(Document.prototype, 'elementsFromPoint', { value: () => [] })

// Without Vitest's globals, Testing Library cannot unmount by itself.
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
})
