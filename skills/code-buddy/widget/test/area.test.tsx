import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { anchorFromArea, holderOf, rectFromArea } from '../src/anchors'
import type { ReviewArea, ReviewComment } from '../src/domain'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

/** Two cards in a section, a gap of 20px between them. */
const PAGE = `
  <h1 data-box="0,0,1000,60">Playground</h1>
  <section data-box="0,100,1000,400">
    <div data-box="20,120,400,200"><p data-box="30,130,300,40">Card A</p></div>
    <div data-box="20,340,400,140"><p data-box="30,350,300,40">Card B</p></div>
  </section>
`

/** happy-dom lays nothing out: each element's box is its `data-box` (left, top, width, height). */
function layout() {
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.getAttribute('data-box') ?? '')
        .split(',')
        .map(Number)
      return DOMRect.fromRect({ x, y, width, height })
    })
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
  onTestFinished(() => {
    box.mockRestore()
    scroll.mockRestore()
  })
}

function page() {
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  return root
}

/** Over the gap between the cards, and a little into each. */
const GAP = { left: 10, top: 300, width: 500, height: 60 }

test.each([
  ['a gap', GAP, 'across <div> <div> <p>'],
  ['a card', { left: 10, top: 110, width: 450, height: 230 }, 'covers <div>'],
  [
    'the empty corner of a section',
    { left: 500, top: 150, width: 100, height: 100 },
    'in <section>',
  ],
])('the chip says what %s holds', async (_, rect, label) => {
  renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([rect.left, rect.top], [rect.left + rect.width, rect.top + rect.height])

  expect((await screen.findByTestId('cb-area-chip')).textContent).toBe(
    `${rect.width} × ${rect.height}${label}`,
  )
})

test('an area records the element it lies in, and what it cuts through', () => {
  layout()
  const root = page()

  const area = anchorFromArea(root, GAP).area

  expect(area?.within).toEqual({
    selector: 'section',
    tag: 'section',
    text: 'Card A Card B',
    offset: { top: 200, left: 10 },
    size: { width: 1000, height: 400 },
  })
  // The two cards, and card B's text, which it cuts too.
  expect(area?.crosses.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
    'section > div:nth-of-type(2)',
    'section > div:nth-of-type(2) > p',
  ])
  expect(area?.covers).toEqual([])
  expect([area?.left, area?.top, area?.width, area?.height]).toEqual([10, 300, 500, 60])
})

test('an area records the outermost elements it covers', () => {
  layout()
  const root = page()

  const area = anchorFromArea(root, { left: 10, top: 110, width: 450, height: 380 }).area

  expect(area?.covers.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
    'section > div:nth-of-type(2)',
  ])
  expect(area?.crosses).toEqual([])
})

test('an area records what it covers inside a block it cuts through', () => {
  layout()
  const root = page()

  // Past card A on the right: the section holds it, card A's text is inside.
  const area = anchorFromArea(root, { left: 25, top: 125, width: 450, height: 50 }).area

  expect(area?.within?.selector).toBe('section')
  expect(area?.crosses.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
  ])
  expect(area?.covers.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1) > p',
  ])
})

test('an area records the innermost elements it cuts through: the buttons around a gap', () => {
  layout()
  const root = page()
  root.insertAdjacentHTML(
    'beforeend',
    `<div data-box="0,600,1000,100"><div data-box="20,620,400,40">
      <a data-box="20,620,150,40">Find a retailer</a><a data-box="200,620,150,40">Ask us</a>
    </div></div>`,
  )

  const area = anchorFromArea(root, { left: 160, top: 610, width: 50, height: 60 }).area

  // The block they sit in, under the holder, and the buttons.
  expect(area?.crosses.map((node) => node.tag)).toEqual(['div', 'a', 'a'])
  expect(area?.crosses.slice(1).map((node) => node.text)).toEqual([
    'Find a retailer',
    'Ask us',
  ])
})

test('an area says when it holds more elements than it records', () => {
  layout()
  const root = page()
  const items = Array.from(
    { length: 12 },
    (_, index) => `<li data-box="20,${610 + index * 30},300,30">Item ${index + 1}</li>`,
  )
  root.insertAdjacentHTML(
    'beforeend',
    `<ul data-box="0,600,1000,400">${items.join('')}</ul>`,
  )

  const area = anchorFromArea(root, { left: 10, top: 605, width: 400, height: 380 }).area

  expect(area?.covers).toHaveLength(10)
  expect(area?.truncated).toBe(true)
  expect(anchorFromArea(root, GAP).area?.truncated).toBeUndefined()
})

test('an area sees through a wrapper with no box of its own', () => {
  layout()
  const root = page()
  const card = root.querySelector('section > div')
  card?.insertAdjacentHTML('beforebegin', '<div style="display: contents"></div>')
  card?.previousElementSibling?.append(card)

  const area = anchorFromArea(root, { left: 10, top: 110, width: 450, height: 230 }).area

  expect(area?.within?.selector).toBe('section')
  expect(area?.covers.map((node) => node.text)).toEqual(['Card A'])
})

test('an area drawn in a list that scrolls stays on what it framed', () => {
  layout()
  const root = page()
  const items = Array.from(
    { length: 6 },
    (_, index) => `<li data-box="20,${610 + index * 30},300,30">Item ${index + 1}</li>`,
  )
  root.insertAdjacentHTML(
    'beforeend',
    `<ul data-box="0,600,400,100">${items.join('')}</ul>`,
  )
  const list = root.querySelector('ul')
  if (!list) throw new Error('no list')
  list.scrollTop = 50

  const area = anchorFromArea(root, { left: 10, top: 610, width: 100, height: 60 }).area
  if (!area) throw new Error('no area')

  expect(area.within?.offset).toEqual({ top: 60, left: 10 })
  // Scrolled back to the top, what it framed is 50px further down.
  list.scrollTop = 0
  expect(rectFromArea(area, holderOf(root, area)).top).toBe(660)
})

test('an area lies in the smallest element that holds it', () => {
  layout()
  const root = page()

  const area = anchorFromArea(root, { left: 35, top: 135, width: 100, height: 20 }).area

  expect(area?.within?.selector).toBe('section > div:nth-of-type(1) > p')
})

test('an area drawn over a modal lies in the modal, not in the page under it', () => {
  layout()
  const root = page()
  root.insertAdjacentHTML(
    'beforeend',
    '<div role="dialog" data-box="100,100,400,400"><p data-box="120,120,200,40">Sure?</p></div>',
  )

  const area = anchorFromArea(root, { left: 110, top: 110, width: 300, height: 100 }).area

  expect(area?.within?.tag).toBe('div')
  expect(area?.within?.text).toBe('Sure?')
  expect(area?.covers.map((node) => node.text)).toEqual(['Sure?'])
})

test('an area is placed on the page, whatever its scroll', () => {
  layout()
  const root = page()
  const scrolled = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500)
  onTestFinished(() => scrolled.mockRestore())

  const area = anchorFromArea(root, GAP).area
  if (!area) throw new Error('no area')

  expect([area.top, area.viewport.scrollY]).toEqual([800, 500])
  // Without its holder, back where it was in the viewport at that scroll.
  root.querySelector('section')?.remove()
  expect(rectFromArea(area, holderOf(root, area)).top).toBe(300)
})

test('an area follows the element it lies in when the layout changes', () => {
  layout()
  const root = page()
  const area = anchorFromArea(root, GAP).area
  if (!area) throw new Error('no area')

  // On a narrower window, the section moved down, halved and grew taller:
  // the area keeps its distance from the top and its height, its width halves.
  root.querySelector('section')?.setAttribute('data-box', '0,200,500,800')

  expect(rectFromArea(area, holderOf(root, area))).toEqual({
    left: 5,
    top: 400,
    width: 250,
    height: 60,
  })
})

test('an area whose element is gone stays where it was on the page', () => {
  layout()
  const root = page()
  const area = anchorFromArea(root, GAP).area
  if (!area) throw new Error('no area')

  root.querySelector('section')?.remove()

  expect(rectFromArea(area, holderOf(root, area))).toEqual(GAP)
})

/** The widget over the two cards. */
function renderCards(comments: ReviewComment[] = []) {
  layout()
  document.body.replaceChildren()
  const server = fakeServer(comments)
  renderWidget()
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  root.setAttribute('data-box', '0,0,1000,2000')
  root.innerHTML = PAGE
  return server
}

test('scrolling the page while drawing stretches the area', async () => {
  renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  fireEvent.mouseDown(screen.getByTestId('cb-draw'), {
    button: 0,
    clientX: 10,
    clientY: 300,
  })
  const scrolled = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200)
  onTestFinished(() => scrolled.mockRestore())
  fireEvent.scroll(document)
  fireEvent.mouseUp(document, { clientX: 510, clientY: 360 })

  // From 300px down the page to 360px down the window, 200px further down.
  expect((await screen.findByTestId('cb-area-chip')).textContent).toMatch(/^500 × 260/)
})

/** Drags from one corner to the other over the drawing layer. */
function drag(from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(screen.getByTestId('cb-draw'), {
    button: 0,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.mouseMove(document, { clientX: to[0], clientY: to[1] })
  fireEvent.mouseUp(document, { clientX: to[0], clientY: to[1] })
}

test('a drawn area is commented on, and stays outlined while the comment is written', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])

  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  expect(screen.queryByTestId('cb-draw')).toBeNull()
  expect(screen.getByTestId('cb-area-chip').textContent).toBe(
    '500 × 60across <div> <div> <p>',
  )
  await screen.findByTestId('cb-area-target')

  fireEvent.change(box, { target: { value: 'Tighten this gap' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  // Saved, the blue outline gives way to the rainbow frame of a comment in progress.
  await screen.findByTestId('cb-area-mark')
  expect(screen.queryByTestId('cb-area-target')).toBeNull()
})

test('the area goes to the server with what it covers', async () => {
  const comments: ReviewComment[] = []
  renderCards(comments)

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([510, 360], [10, 300])
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Tighten this gap' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(comments).toHaveLength(1))
  const area: Partial<ReviewArea> | undefined = comments[0]?.anchor.area
  expect(area).toMatchObject({
    top: 300,
    left: 10,
    width: 500,
    height: 60,
    within: { selector: 'section' },
    covers: [],
  })
  expect(area?.crosses).toHaveLength(3)
})

test('a slip of the mouse draws nothing, and Escape leaves the drawing', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  // Long, but too flat to be an area.
  drag([10, 300], [400, 303])

  expect(screen.getByTestId('cb-draw')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByTestId('cb-draw')).toBeNull()
})

test('an area drawn from a page comment keeps what the reader wrote and attached', async () => {
  renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  const text = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(text, { target: { value: 'Too much space' } })
  fireEvent.paste(text, {
    clipboardData: {
      files: [new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' })],
      types: ['Files'],
    },
  })
  await screen.findByRole('img', { name: 'Attached image 1' })

  fireEvent.click(screen.getByRole('button', { name: 'Draw an area' }))
  drag([10, 300], [510, 360])

  await screen.findByTestId('cb-area-chip')
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('Too much space')
  expect(screen.getByRole('img', { name: 'Attached image 1' })).toBeTruthy()

  // Removed, the comment is about the page again.
  fireEvent.click(screen.getByRole('button', { name: 'Remove the area' }))
  expect(screen.queryByTestId('cb-area-chip')).toBeNull()
  expect(screen.getByRole('checkbox')).toBeTruthy()
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('Too much space')
})

test('an area drawn after pointing at an element keeps the element and the words', async () => {
  renderCards()
  const title = document.querySelector('h1')
  if (!title) throw new Error('no title')
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())
  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })
  fireEvent.change(await screen.findByRole('textbox', { name: 'What should change?' }), {
    target: { value: 'Bigger title' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])

  // The element is in the message, as an image would be: it stays with the words.
  await screen.findByTestId('cb-area-chip')
  expect(screen.getByTestId('cb-picked').textContent).toContain('<h1>')
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('Bigger title')
})

const DRAWN: ReviewArea = {
  top: 300,
  left: 10,
  width: 500,
  height: 60,
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
  within: {
    selector: 'section',
    tag: 'section',
    text: 'Card A Card B',
    offset: { top: 200, left: 10 },
    size: { width: 1000, height: 400 },
  },
  covers: [],
  crosses: [],
}

/** Where a mark shows: the box that cuts it to the part of the page in view. */
const shown = () => screen.getByTestId('cb-area-mark').parentElement?.style

test('an area is in progress until its thread is resolved', async () => {
  renderCards([
    comment({ id: 'c1', area: DRAWN }),
    comment({ id: 'c2', area: DRAWN, state: 'resolved' }),
  ])

  await waitFor(() => expect(screen.getAllByTestId('cb-area-mark')).toHaveLength(1))
  // It follows its section down the page, in the box that cuts it to what shows.
  document.querySelector('section')?.setAttribute('data-box', '0,200,1000,400')
  await waitFor(() => expect(shown()?.top).toBe('400px'))
  expect([shown()?.left, shown()?.width, shown()?.height]).toEqual([
    '10px',
    '500px',
    '60px',
  ])
})

test("the area's chip in a resolved thread shows it again on the page", async () => {
  openPanel('page', 'c1')
  renderCards([comment({ area: DRAWN, state: 'resolved' })])

  // Nothing on the page for a resolved comment, until the reader asks.
  const chip = await screen.findByTestId('cb-area-chip')
  expect(screen.queryByTestId('cb-area-target')).toBeNull()
  fireEvent.mouseEnter(chip)
  await screen.findByTestId('cb-area-target')
  fireEvent.mouseLeave(chip)
  await waitFor(() => expect(screen.queryByTestId('cb-area-target')).toBeNull())

  fireEvent.click(chip)
  // Centred: from 300px down the viewport, to its middle.
  expect(window.scrollBy).toHaveBeenCalledWith({
    top: 300 + 30 - window.innerHeight / 2,
    behavior: 'smooth',
  })
  await screen.findByTestId('cb-area-target')
})

test('an area whose element is hidden is not framed elsewhere', async () => {
  renderCards([comment({ area: DRAWN })])
  await screen.findByTestId('cb-area-mark')

  // A closed tab, a modal: its old place on the page now shows something else.
  document.querySelector('section')?.setAttribute('data-box', '0,0,0,0')

  await waitFor(() => expect(screen.queryByTestId('cb-area-mark')).toBeNull())
})

test("the bubble on an area's frame opens its thread and scrolls to it", async () => {
  renderCards([comment({ area: DRAWN, body: 'Tighten this gap' })])

  fireEvent.click(
    await screen.findByRole('button', { name: 'Open the comment on the drawn area' }),
  )

  await screen.findByTestId('cb-area-chip')
  expect(window.scrollBy).toHaveBeenCalledWith({
    top: 300 + 30 - window.innerHeight / 2,
    behavior: 'smooth',
  })
})

test('an area opened from another page waits for its element to be laid out', async () => {
  const anchor = { section: '', quote: '', occurrence: 0, area: DRAWN }
  sessionStorage.setItem(
    'code-buddy:center',
    JSON.stringify({ anchor, path: '/', id: 'c1' }),
  )
  renderCards([comment({ area: DRAWN })])
  const section = document.querySelector('section')
  section?.setAttribute('data-box', '0,0,0,0')

  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(window.scrollBy).not.toHaveBeenCalled()
  section?.setAttribute('data-box', '0,200,1000,400')

  await waitFor(() =>
    expect(window.scrollBy).toHaveBeenCalledWith({
      top: 400 + 30 - window.innerHeight / 2,
      behavior: 'smooth',
    }),
  )
  expect(sessionStorage.getItem('code-buddy:center')).toBeNull()
})

test("the area's chip works from the keyboard: focused it shows the area, pressed it centres it", async () => {
  openPanel('page', 'c1')
  renderCards([comment({ area: DRAWN, state: 'resolved' })])

  const chip = await screen.findByRole('button', { name: /500 × 60/ })
  fireEvent.focus(chip)
  await screen.findByTestId('cb-area-target')
  fireEvent.blur(chip)
  await waitFor(() => expect(screen.queryByTestId('cb-area-target')).toBeNull())

  // Enter or Space on a focused button is its click.
  fireEvent.click(chip)
  expect(window.scrollBy).toHaveBeenCalledWith({
    top: 300 + 30 - window.innerHeight / 2,
    behavior: 'smooth',
  })
})
