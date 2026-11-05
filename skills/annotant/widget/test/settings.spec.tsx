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

const AUTO = {
  strategy: 'auto',
  trivial: { model: 'haiku' },
  standard: { model: 'sonnet', effort: 'high' },
  hard: { model: 'opus' },
}
const select = (name: string) => {
  const field = screen.getByLabelText(name)
  if (!(field instanceof HTMLSelectElement)) throw new Error(`no ${name} picker`)
  return field
}

test('the settings show the model strategy: Auto, a model per label', async () => {
  fakeServer([], { settings: { instructions: '', max: 4000, models: AUTO } })
  openPanel()
  renderWidget()

  await openSettings()
  const strategy = screen.getByRole('radiogroup', { name: 'How the model is picked' })
  expect(strategy.querySelector('[aria-checked="true"]')?.textContent).toBe('Auto')
  expect(select('Trivial').value).toBe('haiku')
  expect(select('Trivial: effort').value).toBe('')
  expect(select('Standard').value).toBe('sonnet')
  expect(select('Standard: effort').value).toBe('high')
  expect(select('Hard').value).toBe('opus')
  // The session's model is for Fixed only.
  expect([...select('Trivial').options].map((option) => option.value)).toEqual([
    'haiku',
    'sonnet',
    'opus',
  ])
  expect([...select('Hard: effort').options].map((option) => option.value)).toEqual([
    '',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  // Which agents a change reaches.
  expect(
    screen.getByText(/a\s+follow-up to their comment, keep their model/),
  ).toBeTruthy()
})

test("changing a label's model saves the models alone", async () => {
  const server = fakeServer([], {
    settings: { instructions: 'Use tabs.', max: 4000, models: AUTO },
  })
  openPanel()
  renderWidget()

  await openSettings()
  const save = screen.getByRole('button', { name: 'Save' })
  fireEvent.change(select('Trivial'), { target: { value: 'sonnet' } })
  fireEvent.change(select('Trivial: effort'), { target: { value: 'low' } })
  // Back to the model's own effort: none sent.
  fireEvent.change(select('Standard: effort'), { target: { value: '' } })
  expect(save.hasAttribute('disabled')).toBe(false)
  fireEvent.click(save)

  expect(
    await screen.findByText(/next comments' agents start on these models/),
  ).toBeTruthy()
  expect(server.savedModels).toEqual([
    {
      ...AUTO,
      trivial: { model: 'sonnet', effort: 'low' },
      standard: { model: 'sonnet' },
    },
  ])
  expect(server.saved).toEqual([])
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(true))
})

test('Fixed runs every comment on one model, and switching back keeps the labels', async () => {
  const server = fakeServer([], {
    settings: { instructions: '', max: 4000, models: AUTO },
  })
  openPanel()
  renderWidget()

  await openSettings()
  fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }))
  expect(screen.queryByLabelText('Trivial')).toBeNull()
  expect(screen.getByText(/without the classifier/)).toBeTruthy()
  // Back to Auto, as it was: nothing to save.
  fireEvent.click(screen.getByRole('radio', { name: 'Auto' }))
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)

  fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }))
  expect([...select('Every comment').options].map((option) => option.value)).toContain(
    'inherit',
  )
  fireEvent.change(select('Every comment'), { target: { value: 'opus' } })
  fireEvent.change(select('Every comment: effort'), { target: { value: 'max' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(server.savedModels).toEqual([
      { strategy: 'fixed', model: 'opus', effort: 'max' },
    ]),
  )
})

test('a fixed model the file names shows Fixed with it', async () => {
  fakeServer([], {
    settings: {
      instructions: '',
      max: 4000,
      models: { strategy: 'fixed', model: 'opus', effort: 'high' },
    },
  })
  openPanel()
  renderWidget()

  await openSettings()
  expect(screen.getByRole('radio', { name: 'Fixed' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(select('Every comment').value).toBe('opus')
  expect(select('Every comment: effort').value).toBe('high')
})

test('models written by hand are shown as written, with no picker, and never sent', async () => {
  const server = fakeServer([], {
    settings: {
      instructions: '',
      max: 4000,
      models: { strategy: 'custom', text: '{"trivial":"inherit"}' },
    },
  })
  openPanel()
  renderWidget()

  const field = await openSettings()
  expect(screen.getByText('{"trivial":"inherit"}')).toBeTruthy()
  expect(screen.getByText(/written by hand: change it in the file/)).toBeTruthy()
  expect(screen.queryByRole('radiogroup', { name: 'How the model is picked' })).toBeNull()
  fireEvent.change(field, { target: { value: 'Use tabs.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(server.saved).toEqual(['Use tabs.']))
  expect(server.savedModels).toEqual([])
})

test('a save refused as the file changed by hand shows the file as it is now, the text kept', async () => {
  const server = fakeServer([], {
    settings: { instructions: '', max: 4000, models: AUTO },
  })
  openPanel()
  renderWidget()

  const field = await openSettings()
  server.edit({
    instructions: '',
    max: 4000,
    models: { strategy: 'custom', text: '{"trivial":"inherit"}' },
  })
  fireEvent.change(field, { target: { value: 'Use tabs.' } })
  fireEvent.change(select('Trivial'), { target: { value: 'sonnet' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(
    await screen.findByText(/models in .annotant.json was written by hand/),
  ).toBeTruthy()
  expect(await screen.findByText('{"trivial":"inherit"}')).toBeTruthy()
  expect(screen.queryByRole('radiogroup', { name: 'How the model is picked' })).toBeNull()
  expect(field.value).toBe('Use tabs.')
  // Saved again, the instructions alone go.
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(server.saved).toEqual(['Use tabs.', 'Use tabs.']))
  expect(server.savedModels).toHaveLength(1)
})

test('an older server that names no models shows no Model section', async () => {
  fakeServer([], { settings: { instructions: '', max: 4000 } })
  openPanel()
  renderWidget()

  await openSettings()
  expect(screen.queryByRole('heading', { name: 'Model' })).toBeNull()
})

test('changing the instructions and a model saves both in one request', async () => {
  const server = fakeServer([], {
    settings: { instructions: '', max: 4000, models: AUTO },
  })
  openPanel()
  renderWidget()

  const field = await openSettings()
  fireEvent.change(field, { target: { value: 'Use tabs.' } })
  fireEvent.change(select('Hard'), { target: { value: 'sonnet' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(
    await screen.findByText(/next comments' agents follow these settings/),
  ).toBeTruthy()
  expect(server.saved).toEqual(['Use tabs.'])
  expect(server.savedModels).toEqual([{ ...AUTO, hard: { model: 'sonnet' } }])
  expect(
    server.fetch.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1)
})
