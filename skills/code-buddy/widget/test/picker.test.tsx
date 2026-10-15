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
      return boxes.get(this) ?? DOMRect.fromRect()
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

    const event = createEvent[name](first, { clientX: 20, clientY: 30 })
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

  fireEvent.click(first)
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
