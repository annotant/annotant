import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Markdown, blocks } from '../src/markdown'
import {
  Code,
  languageOfFence,
  languageOfFile,
  tokens,
  type Language,
} from '../src/syntax'

/** The coloured tokens of `line`, as `kind:text`. */
const colored = (line: string, language: Language) =>
  tokens(line, language).flatMap(({ text, kind }) => (kind ? [`${kind}:${text}`] : []))

describe('languages', () => {
  test("reads a file's from its extension", () => {
    expect(
      [
        'a.ts',
        'b.mts',
        'c.cts',
        'd.tsx',
        'e.js',
        'f.mjs',
        'g.cjs',
        'h.jsx',
        'i.json',
      ].map(languageOfFile),
    ).toEqual(['ts', 'ts', 'ts', 'tsx', 'js', 'js', 'js', 'js', 'json'])
    expect(languageOfFile('src/tsconfig.json')).toBe('json')
    expect(languageOfFile('src/App.TSX')).toBe('tsx')
  })

  test('has none for another file, a dotfile or a folder named like one', () => {
    expect(languageOfFile('style.css')).toBeUndefined()
    expect(languageOfFile('README')).toBeUndefined()
    expect(languageOfFile('.ts')).toBeUndefined()
    expect(languageOfFile('src.ts/README')).toBeUndefined()
  })

  test("reads a fence's word", () => {
    expect(
      ['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'json', 'JSON'].map(
        languageOfFence,
      ),
    ).toEqual(['ts', 'ts', 'tsx', 'js', 'js', 'js', 'json', 'json'])
    expect(languageOfFence('python')).toBeUndefined()
    expect(languageOfFence('')).toBeUndefined()
    expect(languageOfFence(undefined)).toBeUndefined()
  })
})

describe('tokens', () => {
  test('keep the line whole', () => {
    const line = 'const a = <B c="d">{`e${f}`}</B> // g'
    for (const language of ['ts', 'tsx', 'js', 'json'] as const)
      expect(
        tokens(line, language)
          .map(({ text }) => text)
          .join(''),
      ).toBe(line)
  })

  test('color TypeScript keywords, strings, numbers and comments', () => {
    expect(colored("export const size: number = 0x1F + 2.5e3 // in 'px'", 'ts')).toEqual([
      'keyword:export',
      'keyword:const',
      'keyword:number',
      'number:0x1F',
      'number:2.5e3',
      "comment:// in 'px'",
    ])
    expect(colored('type A = `a ${b}` | "c" /* d */', 'ts')).toEqual([
      'keyword:type',
      'string:`a ${b}`',
      'string:"c"',
      'comment:/* d */',
    ])
  })

  test("read a TypeScript type's < > as no tag", () => {
    expect(colored('const a = <T>(b: Array<string>) => b', 'ts')).toEqual([
      'keyword:const',
      'keyword:string',
    ])
    expect(colored('useState<string>(x)', 'tsx')).toEqual(['keyword:string'])
  })

  test('color JSX tags and attributes, in TSX and JavaScript', () => {
    const line = 'return <Button aria-label="Close" onClick={close}>Hi</Button>'
    const expected = [
      'keyword:return',
      'tag:Button',
      'attr:aria-label',
      'string:"Close"',
      'attr:onClick',
      'tag:Button',
    ]
    expect(colored(line, 'tsx')).toEqual(expected)
    expect(colored(line, 'js')).toEqual(expected)
    // An attribute on a line of its own, its tag opened on a line before.
    expect(colored("  className='row'", 'js')).toEqual(['attr:className', "string:'row'"])
  })

  test('read a comparison as no tag, JSX text or a keyword before a tag as none', () => {
    expect(colored('for (let i = 0; i < len; i++)', 'js')).toEqual([
      'keyword:for',
      'keyword:let',
      'number:0',
    ])
    expect(colored('if (a < b) x', 'tsx')).toEqual(['keyword:if'])
    expect(colored('  Shop <span>Hi</span>', 'tsx')).toEqual(['tag:span', 'tag:span'])
    expect(colored('x < new Date()', 'js')).toEqual(['keyword:new'])
    expect(colored('return <div>', 'tsx')).toEqual(['keyword:return', 'tag:div'])
    expect(colored('ok ? <A /> : <B/>', 'js')).toEqual(['tag:A', 'tag:B'])
  })

  test('read an apostrophe in JSX text as prose, no string', () => {
    expect(colored("<p>Don't save</p>", 'tsx')).toEqual(['tag:p', 'tag:p'])
    expect(colored("f('a')", 'js')).toEqual(["string:'a'"])
  })

  test("keep TypeScript's own words plain as keys", () => {
    expect(colored("{ type: 'added', number : 3, default: 1 }", 'ts')).toEqual([
      "string:'added'",
      'number:3',
      'keyword:default',
      'number:1',
    ])
  })

  test('take linear time on a long hyphenated line, and leave a longer one plain', () => {
    const run = 'a-'.repeat(900)
    const start = performance.now()
    expect(colored(run, 'tsx')).toEqual([])
    expect(performance.now() - start).toBeLessThan(100)
    const long = `const a = '${'x'.repeat(2000)}'`
    expect(tokens(long, 'ts')).toEqual([{ text: long }])
  })

  test("keep TypeScript's own words plain in JavaScript", () => {
    expect(colored('let type = interface', 'js')).toEqual(['keyword:let'])
  })

  test("keep a property named like a keyword plain, not a spread's", () => {
    expect(colored('node.type === a?.default', 'ts')).toEqual([])
    expect(colored('f(...this)', 'ts')).toEqual(['keyword:this'])
  })

  test('color a string or a comment cut by the end of the line up to it', () => {
    expect(colored('const a = "never closed', 'ts')).toEqual([
      'keyword:const',
      'string:"never closed',
    ])
    expect(colored("x('ends on \\", 'js')).toEqual(["string:'ends on \\"])
    expect(colored('a = `line one', 'ts')).toEqual(['string:`line one'])
    expect(colored('b /* open', 'js')).toEqual(['comment:/* open'])
    expect(colored('"key": "cut', 'json')).toEqual(['key:"key"', 'string:"cut'])
  })

  test("color an escaped quote as its string's", () => {
    expect(colored(String.raw`'it\'s' + 1`, 'js')).toEqual([
      String.raw`string:'it\'s'`,
      'number:1',
    ])
  })

  test('color JSON keys, strings, numbers, literals and comments (JSONC)', () => {
    expect(
      colored('  "name" : "an", "n": -1.5e2, "ok": true, "x": null // why', 'json'),
    ).toEqual([
      'key:"name"',
      'string:"an"',
      'key:"n"',
      'number:-1.5e2',
      'key:"ok"',
      'keyword:true',
      'key:"x"',
      'keyword:null',
      'comment:// why',
    ])
  })
})

describe('Code', () => {
  test('renders a span per coloured token, never HTML', () => {
    const { container } = render(
      <pre>
        <Code code={'const a = "<b>x</b>"\nlet c'} language="ts" />
      </pre>,
    )
    expect(container.textContent).toBe('const a = "<b>x</b>"\nlet c')
    expect(container.querySelector('b')).toBeNull()
    expect(
      [...container.querySelectorAll('.an-tok')].map(
        (span) => `${span.className}:${span.textContent}`,
      ),
    ).toEqual([
      'an-tok an-tok--keyword:const',
      'an-tok an-tok--string:"<b>x</b>"',
      'an-tok an-tok--keyword:let',
    ])
  })

  test('renders the code as written without a language', () => {
    const { container } = render(
      <pre>
        <Code code="const a = 1" language={undefined} />
      </pre>,
    )
    expect(container.textContent).toBe('const a = 1')
    expect(container.querySelector('.an-tok')).toBeNull()
  })
})

test('an answer highlights a block its fence marks ts, tsx, js, jsx or json, no other', () => {
  const { container } = render(
    <Markdown
      text={'```ts\nconst a = 1\n```\n\n```python\nimport os\n```\n\n```\nlet b\n```'}
      repository={undefined}
    />,
  )
  const [ts, python, bare] = [...container.querySelectorAll('pre')]
  expect(ts?.textContent).toBe('const a = 1')
  expect([...(ts?.querySelectorAll('.an-tok') ?? [])].map((t) => t.textContent)).toEqual([
    'const',
    '1',
  ])
  expect(python?.textContent).toBe('import os')
  expect(python?.querySelector('.an-tok')).toBeNull()
  expect(bare?.textContent).toBe('let b')
  expect(bare?.querySelector('.an-tok')).toBeNull()
})

test('a fenced block keeps the language its fence names', () => {
  expect(blocks('  ``` jsx\n<A />\n```')).toEqual([
    { kind: 'code', text: '<A />', language: 'js' },
  ])
  expect(blocks('```tsx title="a"\n<A />\n```\n```python\nx\n```\n```\ny')).toEqual([
    { kind: 'code', text: '<A />', language: 'tsx' },
    { kind: 'code', text: 'x', language: undefined },
    { kind: 'code', text: 'y', language: undefined },
  ])
})
