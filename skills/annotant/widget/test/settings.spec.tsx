import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeServer, openPanel } from './server'
import { fromMenu, renderWidget } from './widget'

const openSettings = async () => {
  await screen.findByRole('button', { name: 'More actions' })
  fromMenu('Settings')
  const field = await screen.findByLabelText('Instructions for the agents')
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('no text box')
  return field
}

test("Settings, in the panel's menu, opens the project's instructions for the agents", async () => {
  fakeServer([], { settings: { instructions: 'We use Tailwind.', max: 4000 } })
  openPanel()
  renderWidget()

  const field = await openSettings()
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  expect(field.value).toBe('We use Tailwind.')
  await waitFor(() => expect(document.activeElement).toBe(field))
  // Where they go, and which agents get them.
  expect(screen.getByText(/the next comments get them/)).toBeTruthy()
})

test('saving sends the instructions, and says the next agents follow them', async () => {
  const server = fakeServer([])
  openPanel()
  renderWidget()

  const field = await openSettings()
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.change(field, { target: { value: 'Copy is in Canadian French.' } })
  fireEvent.click(save)

  expect(await screen.findByText(/next comments' agents follow/)).toBeTruthy()
  expect(server.saved).toEqual(['Copy is in Canadian French.'])
  // Saved: nothing left to save until the text changes again.
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(true))
})

test('clearing the instructions says the agents get none', async () => {
  fakeServer([], { settings: { instructions: 'Use tabs.', max: 4000 } })
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(
    await screen.findByText(/next comments' agents get no instructions/),
  ).toBeTruthy()
})

test('instructions saved with a line break at the end are not a change', async () => {
  fakeServer([], { settings: { instructions: 'Use tabs.\n', max: 4000 } })
  openPanel()
  renderWidget()

  await openSettings()
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
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

test("Escape closes the settings, not the panel, and gives the focus back to the menu's button", async () => {
  fakeServer([])
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.keyDown(field, { key: 'Escape' })

  expect(screen.queryByTestId('an-settings')).toBeNull()
  expect(screen.getByTestId('annotant-panel')).toBeTruthy()
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'More actions' }),
  )
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

  await screen.findByRole('button', { name: 'More actions' })
  fromMenu('Settings')
  expect(
    await screen.findByText(/could not be read \(Request failed \(500\)\)/),
  ).toBeTruthy()
})
