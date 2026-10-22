import { act, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Toasts, toast } from '../src/ui'

afterEach(() => {
  act(() => {
    vi.runAllTimers()
  })
  vi.useRealTimers()
})

test('a toast appears in a live region that was there before it', () => {
  vi.useFakeTimers()
  render(<Toasts />)
  const region = screen.getByRole('status')

  act(() => toast('Comment saved'))
  expect(within(region).getByText('Comment saved')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('')
})

test('an error toast interrupts, in an alert region that was there before it, once', () => {
  vi.useFakeTimers()
  render(<Toasts />)
  const alert = screen.getByRole('alert')

  act(() => toast('Request failed', true))
  expect(alert.textContent).toBe('Request failed')
  expect(screen.getByRole('status').textContent).toBe('')
  expect(alert.closest('[role=status]')).toBeNull()
})
