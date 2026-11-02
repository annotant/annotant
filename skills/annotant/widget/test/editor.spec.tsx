import { expect, test } from 'vitest'
import { editorLink, parseEditor } from '../src/editor'

test('opens in VS Code unless .annotant.json names another editor', () => {
  expect(parseEditor(undefined)?.name).toBe('VS Code')
  expect(parseEditor('cursor')?.name).toBe('Cursor')
  expect(parseEditor(false)).toBeUndefined()
})

test('takes a template of its own, never one that would run code in the page', () => {
  expect(parseEditor('idea://open?file={path}&line={line}')).toEqual({
    name: 'your editor',
    template: 'idea://open?file={path}&line={line}',
  })
  expect(parseEditor('javascript:alert(1)//{path}')).toBeUndefined()
  expect(parseEditor('data:text/html,{path}')).toBeUndefined()
  // No path to put in, or no scheme, or a name it does not know: no link.
  expect(parseEditor('idea://open')).toBeUndefined()
  expect(parseEditor('/bin/{path}')).toBeUndefined()
  expect(parseEditor('constructor')).toBeUndefined()
  expect(parseEditor(42)).toBeUndefined()
})

test("links the file from the project's root, its path encoded", () => {
  const vscode = parseEditor('vscode')
  if (!vscode) throw new Error('vscode expected')
  expect(editorLink(vscode, '/work/shop', 'src/pages/Home.tsx')).toBe(
    'vscode://file/work/shop/src/pages/Home.tsx:1',
  )
  // A file the project's agents may edit next to it, and a name to encode.
  expect(editorLink(vscode, '/work/shop/web', '../api/a b#1.ts', 12)).toBe(
    'vscode://file/work/shop/api/a%20b%231.ts:12',
  )
  expect(editorLink(vscode, 'C:\\work\\shop', 'src\\App.tsx')).toBe(
    'vscode://file/C:/work/shop/src/App.tsx:1',
  )
})
