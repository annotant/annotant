import { expect, test } from 'vitest'
import {
  anchorFromElement,
  anchorFromSelection,
  elementFromAnchor,
  rangeFromAnchor,
} from '../src/anchors'

/** Mounts `html` as the page's root. */
function page(html: string) {
  document.body.innerHTML = `<main>${html}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  return root
}

/**
 * Selects `range`. `rendered` is what Chrome's `toString()` gives for it (a
 * line break between blocks, the text as CSS shows it…); happy-dom's does not.
 */
function select(range: Range, rendered: string): Selection {
  const selection = getSelection()
  if (!selection) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  selection.toString = () => rendered
  return selection
}

/** From the start of `from`'s text to the end of `to`'s. */
function between(from: Element, to: Element): Range {
  const range = document.createRange()
  range.setStart(from.firstChild ?? from, 0)
  const last = to.lastChild ?? to
  range.setEnd(last, last.textContent?.length ?? 0)
  return range
}

test.each([
  ['two blocks', '<div>Part 1</div><div>part 2</div>', 'div', 'Part 1\npart 2'],
  ['a list', '<ul><li>First</li><li>second</li></ul>', 'li', 'First\nsecond'],
  ['a table', '<table><tr><td>Name</td><td>price</td></tr></table>', 'td', 'Name\tprice'],
  ['a line break', '<p><span>Line</span><br><span>next</span></p>', 'span', 'Line\nnext'],
])('a selection across %s can be commented on', (_, html, tag, rendered) => {
  const root = page(html)
  const [from, to] = root.querySelectorAll(tag)
  if (!from || !to) throw new Error(`no ${tag}`)

  const anchor = anchorFromSelection(root, select(between(from, to), rendered))

  expect(anchor?.quote).toBe(rendered.replace(/\s+/g, ' '))
  // Found again, its highlight spans both parts.
  const range = anchor && rangeFromAnchor(root, anchor)
  expect(range?.startContainer).toBe(from.firstChild)
  expect(range?.endContainer).toBe(to.firstChild)
})

// The rendered text differs from the page's: the quote is the page's, so it is found again.
test.each([
  [
    'text-transform',
    '<p style="text-transform: uppercase">Small-batch, since 2018</p>',
    'SMALL-BATCH, SINCE 2018',
    'Small-batch, since 2018',
  ],
  [
    'hidden text',
    '<p>Price <span style="display: none">hidden</span>14 dollars</p>',
    'Price 14 dollars',
    'Price hidden14 dollars',
  ],
  [
    'text that cannot be selected',
    '<p>One <span style="user-select: none">skip</span> two</p>',
    'One  two',
    'One skip two',
  ],
  [
    'a select',
    '<p>Pick <select><option>Opt A</option><option>Opt B</option></select> end</p>',
    'Pick  end',
    'Pick end',
  ],
  ['a textarea', '<p>Note <textarea>TA</textarea> end</p>', 'Note  end', 'Note end'],
  [
    'a style between blocks',
    '<div>Before</div><style>.x { color: red }</style><div>after</div>',
    'Before\nafter',
    'Before after',
  ],
  [
    'a script between blocks',
    '<div>Before</div><script>var a = 1</script><div>after</div>',
    'Before\nafter',
    'Before after',
  ],
  [
    'screen-reader-only text',
    '<p>Price <span style="position: absolute; clip: rect(0, 0, 0, 0)">sr</span> 14</p>',
    'Price sr14',
    'Price sr 14',
  ],
])('a selection over %s can be commented on', (_, html, rendered, quote) => {
  const root = page(html)
  const range = document.createRange()
  range.selectNodeContents(root)

  const anchor = anchorFromSelection(root, select(range, rendered))

  expect(anchor?.quote).toBe(quote)
  const found = anchor && rangeFromAnchor(root, anchor)
  expect(found?.toString().replace(/\s+/g, ' ')).toContain(quote.split(' ').at(-1))
})

test('inline elements add no separator', () => {
  const root = page('<p>Bigger <b>title</b>s here</p>')
  const p = root.querySelector('p')
  const b = root.querySelector('b')
  if (!p || !b) throw new Error('no text')
  const anchor = anchorFromSelection(root, select(between(p, b), 'Bigger title'))
  expect(anchor?.quote).toBe('Bigger title')
})

test('the occurrence is the one selected', () => {
  const root = page(
    '<div>Same</div><div>text</div><p>gap</p><div>Same</div><div>text</div>',
  )
  const divs = root.querySelectorAll('div')
  const from = divs[2]
  const to = divs[3]
  if (!from || !to) throw new Error('no div')
  const anchor = anchorFromSelection(root, select(between(from, to), 'Same\ntext'))
  expect(anchor?.occurrence).toBe(1)
})

test('a selection with no text to read is not commented on', () => {
  const root = page('<p>Note <textarea>TA</textarea> end</p>')
  const textarea = root.querySelector('textarea')
  if (!textarea) throw new Error('no textarea')
  const range = document.createRange()
  range.selectNodeContents(textarea)
  expect(anchorFromSelection(root, select(range, 'TA'))).toBeUndefined()
})

test.each([
  // Saved before blocks were separated: the two parts read as one word.
  ['saved without a separator', '<div>Part 1</div><div>part 2</div>', 'Part 1part 2'],
  // A span that is a block on a phone, inline on a desktop.
  [
    'saved on another layout',
    '<h1><span>Small-batch</span><span>coffee</span></h1>',
    'Small-batch coffee',
  ],
])('a quote %s is still found', (_, html, quote) => {
  const root = page(html)
  const range = rangeFromAnchor(root, { section: '', quote, occurrence: 0 })
  expect(range?.toString()).toBe(root.textContent)
})

const TODOS = `<ul>${['Buy milk', 'Walk dog', 'Call mum', 'Fix bike', 'Read book']
  .map((todo) => `<li data-testid="todo-item"><span>${todo}</span></li>`)
  .join('')}</ul>`

test.each([
  ['the element', 'li'],
  ['a child', 'li span'],
])('pointing at %s with a repeated test id finds it again', (_, selector) => {
  const root = page(TODOS)
  const picked = Array.from(root.querySelectorAll(selector))[4]
  if (!picked) throw new Error('no fifth todo')

  const anchor = anchorFromElement(root, picked)

  expect(root.querySelectorAll(anchor.element?.selector ?? '')).toHaveLength(1)
  expect(elementFromAnchor(root, anchor)).toBe(picked)
})

test('a unique test id is the selector', () => {
  const root = page(`<section data-testid="todos">${TODOS}</section>`)
  const picked = root.querySelector('section')
  if (!picked) throw new Error('no section')
  expect(anchorFromElement(root, picked).element?.selector).toBe('[data-testid="todos"]')
})

test('a test id with a quote is found again', () => {
  const root = page('<p data-testid=\'say "hi"\'>Hi</p><p>Other</p>')
  const picked = root.querySelector('p')
  if (!picked) throw new Error('no p')
  expect(elementFromAnchor(root, anchorFromElement(root, picked))).toBe(picked)
})

// Saved before selectors were unique: `[data-testid="todo-item"]` matches all five.
test('an ambiguous selector finds the element with the saved text', () => {
  const root = page(TODOS)
  const element = {
    selector: '[data-testid="todo-item"]',
    tag: 'li',
    text: 'Read book',
    html: '<li data-testid="todo-item"><span>Read book</span></li>',
  }
  const anchor = { quote: '', occurrence: 0, section: '', element }

  expect(elementFromAnchor(root, anchor)?.textContent).toBe('Read book')
  // None has the saved text: no element rather than the wrong one.
  expect(
    elementFromAnchor(root, { ...anchor, element: { ...element, text: 'Gone' } }),
  ).toBeUndefined()
  // Another tag than the one saved: not that element.
  expect(
    elementFromAnchor(root, { ...anchor, element: { ...element, tag: 'p' } }),
  ).toBeUndefined()
})

test('the only match is found after its text changed', () => {
  const root = page('<h1 data-testid="title">New title</h1>')
  const element = { selector: '[data-testid="title"]', tag: 'h1', text: 'Old', html: '' }
  expect(
    elementFromAnchor(root, { quote: '', occurrence: 0, section: '', element }),
  ).toBe(root.querySelector('h1'))
})
