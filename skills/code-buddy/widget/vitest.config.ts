import { defineConfig } from 'vitest/config'

// The widget's component tests; the scripts' and the server's stay on node:test.
// `*.spec.tsx`, not `*.test.tsx`: `claude plugin test` (test:hooks) runs every *.test.ts(x).
export default defineConfig({
  define: { CODE_BUDDY_VERSION: JSON.stringify('0.0.0-test'), CODE_BUDDY_DEBUG: 'true' },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.spec.tsx'],
    setupFiles: ['test/setup.ts'],
    unstubGlobals: true,
  },
})
