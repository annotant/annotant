import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

const openSettings = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  const field = await screen.findByLabelText('Instructions for the agents')
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('no text box')
  return field
}

test("the panel's gear opens the project's instructions for the agents", async () => {
  fakeServer([], { settings: { instructions: 'We use Tailwind.', max: 4000 } })
  openPanel()
  renderWidget()

  const field = await openSettings()
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  expect(field.value).toBe('We use Tailwind.')
  await waitFor(() => expect(document.activeElement).toBe(field))
  expect(screen.queryByTestId('an-settings-pending')).toBeNull()
})

test('saving sends the instructions, and says they wait for the reader in Claude Code', async () => {
  const server = fakeServer([])
  openPanel()
  renderWidget()

  const field = await openSettings()
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.change(field, { target: { value: 'Copy is in Canadian French.' } })
  fireEvent.click(save)

  const pending = await screen.findByTestId('an-settings-pending')
  expect(pending.textContent).toContain('/annotant-settings')
  expect(server.saved).toEqual(['Copy is in Canadian French.'])
})

test('a change still waiting shows again when the dialog opens', async () => {
  fakeServer([], {
    settings: {
      instructions: '',
      pending: {
        instructions: "Don't touch src/legacy/.",
        at: '2026-01-01T10:00:00.000Z',
      },
      max: 4000,
    },
  })
  openPanel()
  renderWidget()

  const field = await openSettings()
  expect(field.value).toBe("Don't touch src/legacy/.")
  expect(screen.getByTestId('an-settings-pending')).toBeTruthy()
})

test('instructions over the limit cannot be saved', async () => {
  fakeServer([], { settings: { instructions: '', max: 10 } })
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.change(field, { target: { value: 'x'.repeat(11) } })
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('11 / 10')).toBeTruthy()
})

test('Escape closes the settings, not the panel, and gives the focus back to the gear', async () => {
  fakeServer([])
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.keyDown(field, { key: 'Escape' })

  expect(screen.queryByTestId('an-settings')).toBeNull()
  expect(screen.getByTestId('annotant-panel')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }))
})

test("a refused save shows the server's words, and keeps the text", async () => {
  fakeServer([])
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.change(field, { target: { value: 'Use tabs.‮' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText(/control or invisible characters/)).toBeTruthy()
  expect(field.value).toBe('Use tabs.‮')
  expect(screen.queryByTestId('an-settings-pending')).toBeNull()
})

test('saving the instructions .annotant.json holds withdraws the waiting change', async () => {
  fakeServer([], {
    settings: {
      instructions: 'Use tabs.',
      pending: { instructions: 'Use spaces.', at: '2026-01-01T10:00:00.000Z' },
      max: 4000,
    },
  })
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.change(field, { target: { value: 'Use tabs.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByTestId('an-settings-pending')).toBeNull())
  expect(field.value).toBe('Use tabs.')
})

test('settings that cannot be read say why', async () => {
  const server = fakeServer([])
  const answer = server.fetch.getMockImplementation()
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) =>
    new URL(input).pathname.endsWith('/api/settings')
      ? new Response(null, { status: 500 })
      : (answer?.(input, init) ?? new Response(null, { status: 404 })),
  )
  openPanel()
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  expect(
    await screen.findByText(/could not be read \(Request failed \(500\)\)/),
  ).toBeTruthy()
})
