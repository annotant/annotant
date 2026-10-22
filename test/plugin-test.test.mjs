import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname

test('leaves claude plugin test the hooks suite alone', () => {
  // `npm run test:hooks` runs `claude plugin test .`, which loads every
  // *.test.ts and *.test.tsx under the plugin as a hooks test: any other suite
  // fails there, as the widget's Vitest ones did before they became *.spec.tsx.
  const files = execFileSync('git', ['ls-files', '--', '*.test.ts', '*.test.tsx'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.deepEqual(files.split('\n').filter(Boolean), ['test/hooks.test.ts'])
})
