import { fireEvent, screen } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fakeServer } from './server'
import { renderWidget } from './widget'

/** A menu of the page that closes on a press outside it, as Radix's and MUI's do. */
function outsidePress(type: 'pointerdown' | 'mousedown' | 'click' | 'touchend') {
  const onPress = vi.fn()
  document.addEventListener(type, onPress)
  onTestFinished(() => document.removeEventListener(type, onPress))
  return onPress
}

const pickButton = () => screen.getByRole('button', { name: 'Point at element' })

test("a pointerdown on the widget's buttons stays in the widget", () => {
  fakeServer([])
  const onPress = outsidePress('pointerdown')
  renderWidget()
  fireEvent.pointerDown(pickButton())
  expect(onPress).not.toHaveBeenCalled()
})

test("a mousedown on the widget's buttons stays in the widget, and leaves the focus where it is", () => {
  fakeServer([])
  const onPress = outsidePress('mousedown')
  renderWidget()
  // false: the press's default, the button taking the focus, is prevented.
  expect(fireEvent.mouseDown(pickButton())).toBe(false)
  expect(onPress).not.toHaveBeenCalled()
})

test("a click on the widget's buttons stays in the widget, and still does what it says", () => {
  fakeServer([])
  const onPress = outsidePress('click')
  renderWidget()
  fireEvent.click(pickButton())
  expect(onPress).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
})

test("a touchend on the widget's buttons stays in the widget", () => {
  fakeServer([])
  const onPress = outsidePress('touchend')
  renderWidget()
  fireEvent.touchEnd(pickButton())
  expect(onPress).not.toHaveBeenCalled()
})

test('a press in the message box stays in the widget, and still focuses it', async () => {
  fakeServer([])
  const onPointer = outsidePress('pointerdown')
  const onMouse = outsidePress('mousedown')
  renderWidget()
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
  const box = await screen.findByRole('textbox')
  fireEvent.pointerDown(box)
  expect(fireEvent.mouseDown(box)).toBe(true)
  expect(onPointer).not.toHaveBeenCalled()
  expect(onMouse).not.toHaveBeenCalled()
})
