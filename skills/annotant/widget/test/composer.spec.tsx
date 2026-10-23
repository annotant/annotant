import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Composer } from '../src/ui'

function renderComposer({ disabled = false, initial = '' } = {}) {
  const onSubmit = vi.fn()
  const onEscape = vi.fn()
  function Host() {
    const [value, setValue] = useState(initial)
    return (
      <Composer
        value={value}
        images={[]}
        placeholder="What should change?"
        sendLabel="Save"
        disabled={disabled}
        onChange={setValue}
        onSubmit={onSubmit}
        onEscape={onEscape}
      />
    )
  }
  render(<Host />)
  return {
    box: screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'What should change?',
    }),
    send: screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }),
    onSubmit,
    onEscape,
  }
}

test('Enter sends', () => {
  const { box, onSubmit } = renderComposer()
  fireEvent.change(box, { target: { value: 'Bigger title' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledOnce()
})

test('the send button sends', () => {
  const { box, send, onSubmit } = renderComposer()
  fireEvent.change(box, { target: { value: 'Bigger title' } })
  fireEvent.click(send)
  expect(onSubmit).toHaveBeenCalledOnce()
})

test('Shift+Enter breaks the line instead', () => {
  const { box, onSubmit } = renderComposer({ initial: 'Bigger title' })
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
  expect(onSubmit).not.toHaveBeenCalled()
})

test('Enter while composing an accented letter does not send', () => {
  const { box, onSubmit } = renderComposer({ initial: 'Bigger title' })
  fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
  expect(onSubmit).not.toHaveBeenCalled()
})

test('blank text is not sent', () => {
  const { box, send, onSubmit } = renderComposer({ initial: '  \n ' })
  expect(send.disabled).toBe(true)
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(onSubmit).not.toHaveBeenCalled()
})

test('nothing is sent while disabled', () => {
  const { box, send, onSubmit } = renderComposer({ disabled: true, initial: 'Bigger' })
  expect(send.disabled).toBe(true)
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(onSubmit).not.toHaveBeenCalled()
})

test('Escape calls onEscape', () => {
  const { box, onEscape, onSubmit } = renderComposer({ initial: 'Bigger' })
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(onEscape).toHaveBeenCalledOnce()
  expect(onSubmit).not.toHaveBeenCalled()
})
