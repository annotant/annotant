import { act, createEvent, fireEvent, render } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { ElementPicker, HOVER_DWELL_MS } from '../src/overlays'

/** A page of a table's cells, laid side by side: happy-dom lays nothing out. */
function page() {
  const root = document.createElement('main')
  root.innerHTML = '<table><tr><td>One</td><td>Two</td></tr></table><p>Text</p>'
  document.body.append(root)
  const [first, second] = Array.from(root.querySelectorAll('td'))
  const text = root.querySelector('p')
  if (!first || !second || !text) throw new Error('no cells or text')
  const boxes = new Map<Element, DOMRect>([
    [first, DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 30 })],
    [second, DOMRect.fromRect({ x: 110, y: 20, width: 80, height: 30 })],
    [text, DOMRect.fromRect({ x: 10, y: 70, width: 180, height: 20 })],
  ])
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      return boxes.get(this) ?? new DOMRect()
    })
  vi.useFakeTimers()
  let under: Element | null = null
  const point = vi.spyOn(document, 'elementFromPoint').mockImplementation(() => under)
  onTestFinished(() => {
    vi.useRealTimers()
    box.mockRestore()
    point.mockRestore()
    root.remove()
  })
  /** The pointer moves over `element`, or over nothing to pick, and stays there `ms`. */
  const hover = (element: Element | undefined, ms = HOVER_DWELL_MS) => {
    under = element ?? null
    fireEvent.mouseMove(document)
    vi.advanceTimersByTime(ms)
  }
  return { root, first, second, text, boxes, hover }
}

const outline = () => document.querySelector<HTMLElement>('.cb-hover')

test('the outline glides to the next element rather than appearing anew', () => {
  const { root, first, text, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)

  act(() => hover(first))
  const shown = outline()
  act(() => hover(text))

  // The same outline, moved by its transform: a transition can carry it there.
  expect(outline()).toBe(shown)
  expect(shown?.style.transform).toBe('translate(10px, 70px)')
  expect(shown?.style.width).toBe('180px')
  expect(shown?.textContent).toBe('p')
})

test("the outline takes the element's rounded corners", () => {
  const { root, first, text, hover } = page()
  text.setAttribute('style', 'border-radius: 12px')
  first.setAttribute('style', 'border-radius: 8px 4px')
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)

  act(() => hover(text))
  expect(outline()?.style.borderRadius).toBe('12px')

  act(() => hover(first))
  expect([
    outline()?.style.borderTopLeftRadius,
    outline()?.style.borderTopRightRadius,
  ]).toEqual(['8px', '4px'])
})

test('the outline moves only once the pointer stays on an element', () => {
  const { root, first, second, text, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(first))

  // Passing over a cell on the way to the text: the outline waits.
  act(() => hover(second, HOVER_DWELL_MS - 1))
  act(() => hover(text, HOVER_DWELL_MS - 1))
  expect(outline()?.style.transform).toBe('translate(10px, 20px)')

  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(outline()?.style.transform).toBe('translate(10px, 70px)')
})

test('across a gap between two elements, the outline fades out and glides on', () => {
  const { root, first, second, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)

  act(() => hover(first))
  const shown = outline()
  act(() => hover(root))

  expect(outline()).toBe(shown)
  expect(shown?.hasAttribute('data-hidden')).toBe(true)

  act(() => hover(second))
  expect(outline()).toBe(shown)
  expect(shown?.hasAttribute('data-hidden')).toBe(false)
  expect(shown?.style.transform).toBe('translate(110px, 20px)')
})

test('after a scroll, the outline follows its element at once', () => {
  const { root, first, second, boxes, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(first))

  boxes.set(first, DOMRect.fromRect({ x: 10, y: -40, width: 100, height: 30 }))
  act(() => {
    fireEvent.scroll(document)
  })

  expect(outline()?.style.transform).toBe('translate(10px, -40px)')
  expect(outline()?.hasAttribute('data-instant')).toBe(true)

  act(() => hover(second))
  expect(outline()?.hasAttribute('data-instant')).toBe(false)
})

test('an element gone from the page takes its outline with it', () => {
  const { root, first, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(first))

  first.remove()
  act(() => hover(undefined))

  // Not slid to the viewport's corner, where a detached element's box is.
  expect(outline()).toBeNull()
})

test.each(['pointerDown', 'mouseDown', 'pointerUp', 'mouseUp', 'click'] as const)(
  'a %s on the element being picked never reaches the page',
  (name) => {
    const { root, first, hover } = page()
    const reached = vi.fn()
    const type = name.toLowerCase()
    first.addEventListener(type, reached)
    document.addEventListener(type, reached)
    onTestFinished(() => document.removeEventListener(type, reached))
    render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
    act(() => hover(first))

    const event = createEvent[name](first, { clientX: 20, clientY: 30, detail: 1 })
    fireEvent(first, event)

    expect(reached).not.toHaveBeenCalled()
    // Nor its default: no focus taken, no text selection started.
    expect(event.defaultPrevented).toBe(true)
  },
)

test('only the click picks the element', () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))

  fireEvent.pointerDown(first)
  fireEvent.mouseDown(first)
  fireEvent.pointerUp(first)
  fireEvent.mouseUp(first)
  expect(onPick).not.toHaveBeenCalled()

  fireEvent.click(first, { detail: 1 })
  expect(onPick).toHaveBeenCalledExactlyOnceWith(first)
})

test('a press on nothing to pick reaches the page', () => {
  const { root, hover } = page()
  const reached = vi.fn()
  root.addEventListener('mousedown', reached)
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(root))

  fireEvent.mouseDown(root)

  expect(reached).toHaveBeenCalledOnce()
})

test("a click on the widget's own buttons reaches them, not the picker", () => {
  const { root, hover } = page()
  const widget = document.createElement('code-buddy-widget')
  widget.setAttribute('data-code-buddy', '')
  const cancel = document.createElement('button')
  widget.append(cancel)
  root.append(widget)
  const onPick = vi.fn()
  const clicked = vi.fn()
  cancel.addEventListener('click', clicked)
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(cancel))

  fireEvent.click(cancel, { detail: 1 })

  expect(onPick).not.toHaveBeenCalled()
  expect(clicked).toHaveBeenCalledOnce()
})

test("the picker puts the host's cursor back", () => {
  const { root } = page()
  document.documentElement.style.cursor = 'wait'
  onTestFinished(() => document.documentElement.removeAttribute('style'))
  const { unmount } = render(
    <ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />,
  )
  expect(document.documentElement.style.cursor).toBe('crosshair')

  unmount()
  expect(document.documentElement.style.cursor).toBe('wait')
})

/** The reader presses `key`, with the focus on the page. */
const pressKey = (key: string) => act(() => void fireEvent.keyDown(document, { key }))

test('the arrow keys move the outline through the page, and Enter picks', () => {
  const { root, second } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)

  // From nothing outlined, the page's first element.
  pressKey('ArrowDown')
  expect(outline()?.textContent).toBe('table')
  pressKey('ArrowRight')
  expect(outline()?.textContent).toBe('p')
  pressKey('ArrowLeft')
  // Down to the first cell, through the table's body and row.
  for (let step = 0; step < 3; step += 1) pressKey('ArrowDown')
  expect(outline()?.style.transform).toBe('translate(10px, 20px)')
  pressKey('ArrowRight')
  expect(outline()?.style.transform).toBe('translate(110px, 20px)')
  expect(scroll.mock.contexts.at(-1)).toBe(second)
  // Past the last sibling, or up past the page's elements, it stays.
  pressKey('ArrowRight')
  pressKey('Enter')
  expect(onPick).toHaveBeenCalledWith(second)
})

test('the arrow keys go up to the parent, never past the page', () => {
  const { root, first, hover } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))

  for (let step = 0; step < 6; step += 1) pressKey('ArrowUp')
  pressKey('Enter')

  expect(onPick).toHaveBeenCalledWith(root.querySelector('table'))
})

test('Enter picks nothing while the pointer is off every element', () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  act(() => hover(undefined))

  fireEvent.keyDown(document, { key: 'Enter' })

  expect(onPick).not.toHaveBeenCalled()
})

test("the picker's keys leave a field and the browser's shortcuts alone", () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  const field = document.createElement('textarea')
  document.body.append(field)
  onTestFinished(() => field.remove())

  expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
  expect(fireEvent.keyDown(document, { key: 'ArrowUp', shiftKey: true })).toBe(true)
  expect(onPick).not.toHaveBeenCalled()
  expect(outline()?.textContent).toBe('td')
})

test('the arrow keys skip the widget and what draws nothing', () => {
  const { root } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  root.insertAdjacentHTML(
    'afterbegin',
    '<script></script><code-buddy-widget data-code-buddy></code-buddy-widget><div hidden></div>',
  )
  // happy-dom lays nothing out: the hidden element has no box, as in a browser.
  const hidden = root.querySelector('[hidden]')
  if (!hidden) throw new Error('no hidden element')
  vi.spyOn(hidden, 'getClientRects').mockReturnValue(
    Object.assign([], { item: () => null }),
  )
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)

  pressKey('ArrowDown')
  pressKey('ArrowLeft')
  pressKey('Enter')

  expect(onPick).toHaveBeenCalledWith(root.querySelector('table'))
})

test('Enter on a button is the button’s, not a pick', () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  const cancel = document.createElement('button')
  document.body.append(cancel)
  onTestFinished(() => cancel.remove())

  expect(fireEvent.keyDown(cancel, { key: 'Enter' })).toBe(true)
  expect(onPick).not.toHaveBeenCalled()
})

test('the arrow keys move the outline with the focus on a button', () => {
  const { root, first, hover } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(first))
  const button = document.createElement('button')
  document.body.append(button)
  onTestFinished(() => button.remove())

  act(() => void fireEvent.keyDown(button, { key: 'ArrowRight' }))

  expect(outline()?.style.transform).toBe('translate(110px, 20px)')
})

test('Enter picks the element the arrows moved to, even with the focus on a button', () => {
  const { root, first, second, hover } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  // The picker's own button, clicked to start it, keeps the focus.
  const button = document.createElement('button')
  document.body.append(button)
  onTestFinished(() => button.remove())

  act(() => void fireEvent.keyDown(button, { key: 'ArrowRight' }))
  // Once the focus moves, the button it reaches keeps its Enter again.
  fireEvent.focusIn(button)
  expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
  expect(onPick).not.toHaveBeenCalled()
  act(() => void fireEvent.keyDown(button, { key: 'ArrowLeft' }))
  act(() => void fireEvent.keyDown(button, { key: 'ArrowRight' }))

  expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(false)
  expect(onPick).toHaveBeenCalledWith(second)
})

test('once the pointer moves the outline, a button has its Enter back', () => {
  const { root, first, text, hover } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  const button = document.createElement('button')
  document.body.append(button)
  onTestFinished(() => button.remove())
  act(() => void fireEvent.keyDown(button, { key: 'ArrowRight' }))

  act(() => hover(text))

  expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
  expect(onPick).not.toHaveBeenCalled()
})

test('the click Enter makes of a button is the button’s, not a pick, even with the key kept', () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  const button = document.createElement('button')
  const pressed = vi.fn()
  button.addEventListener('click', pressed)
  // The page's menu keeps its keys to itself.
  button.addEventListener('keydown', (event) => event.stopPropagation())
  document.body.append(button)
  onTestFinished(() => button.remove())
  // A click from the keyboard is at 0, 0: over the page's first element.
  act(() => hover(first))

  fireEvent.keyDown(button, { key: 'Enter' })
  // No press of the pointer: `detail` 0.
  fireEvent.click(button)

  expect(pressed).toHaveBeenCalled()
  expect(onPick).not.toHaveBeenCalled()
  // The pointer's next click picks again.
  fireEvent.pointerDown(first)
  fireEvent.click(first, { detail: 1 })
  expect(onPick).toHaveBeenCalledWith(first)
})

test('a focused link keeps its Enter, as anything focused does', () => {
  const { root, first, hover } = page()
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)
  act(() => hover(first))
  const link = document.createElement('a')
  link.href = '#somewhere'
  document.body.append(link)
  onTestFinished(() => link.remove())

  const tab = document.createElement('div')
  tab.setAttribute('role', 'tab')
  tab.tabIndex = 0
  document.body.append(tab)
  onTestFinished(() => tab.remove())

  expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true)
  expect(fireEvent.keyDown(tab, { key: 'Enter' })).toBe(true)
  expect(onPick).not.toHaveBeenCalled()
  // Nothing focused, Enter picks.
  expect(fireEvent.keyDown(document.body, { key: 'Enter' })).toBe(false)
  expect(onPick).toHaveBeenCalledWith(first)
})

test('the arrow keys go through a wrapper drawing no box, to its children', () => {
  const { root } = page()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  root.insertAdjacentHTML(
    'afterbegin',
    '<div style="display: contents"><section>Island</section></div>',
  )
  const wrapper = root.firstElementChild
  if (!wrapper) throw new Error('no wrapper')
  // happy-dom lays nothing out: no box of its own, as in a browser.
  vi.spyOn(wrapper, 'getClientRects').mockReturnValue(
    Object.assign([], { item: () => null }),
  )
  const onPick = vi.fn()
  render(<ElementPicker root={root} onPick={onPick} onCancel={() => {}} />)

  // The island first, then the table beside it, then up: the page, not the wrapper.
  pressKey('ArrowDown')
  pressKey('Enter')
  expect(onPick).toHaveBeenLastCalledWith(root.querySelector('section'))
  pressKey('ArrowRight')
  pressKey('Enter')
  expect(onPick).toHaveBeenLastCalledWith(root.querySelector('table'))
})
