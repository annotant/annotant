import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget, startPageComment } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
}

/** The page the test is on, back to `/` once it ends. */
function visit(path: string) {
  history.pushState(null, '', path)
  onTestFinished(() => history.pushState(null, '', '/'))
}

/** Where the widget sends the browser, without going. */
function navigations() {
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
  onTestFinished(() => assign.mockRestore())
  return assign
}

test("a new comment keeps the page's query, not the tokens a sign-in left in it", async () => {
  visit(
    '/cards?tab=2&code=abc&state=xyz&access_token=t&Session_Id=s&oobCode=o#id_token=t',
  )
  const server = fakeServer([])
  renderWidget()
  await startPageComment()
  const box = screen.getByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => {
    const call = server.fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = call?.[1]?.body
    expect(typeof body === 'string' && JSON.parse(body)).toMatchObject({
      route: '/cards',
      url: `${window.location.origin}/cards?tab=2`,
    })
  })
})

test('a query with no secret is kept as the browser wrote it', async () => {
  visit('/cards?q=a%20b&tag=x+y')
  const server = fakeServer([])
  renderWidget()
  await startPageComment()
  const box = screen.getByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => {
    const call = server.fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = call?.[1]?.body
    expect(typeof body === 'string' && JSON.parse(body)).toMatchObject({
      url: `${window.location.origin}/cards?q=a%20b&tag=x+y`,
    })
  })
})

test("an app's own state stays in the query when no sign-in left a secret there", async () => {
  visit('/issues?state=closed&page=2')
  const server = fakeServer([])
  renderWidget()
  await startPageComment()
  const box = screen.getByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => {
    const call = server.fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = call?.[1]?.body
    expect(typeof body === 'string' && JSON.parse(body)).toMatchObject({
      url: `${window.location.origin}/issues?state=closed&page=2`,
    })
  })
})

test("a comment's page on the app is a link to it", async () => {
  fakeServer([comment({ url: 'http://localhost/cards?tab=2' })])
  openPanel('all')
  renderWidget()

  const link = await screen.findByRole('link', { name: '/cards?tab=2' })
  expect(link.getAttribute('href')).toBe('/cards?tab=2')
})

/** A link to the page elsewhere, by its text: CodeQL takes a regular expression for a URL check. */
const leaves = (link: HTMLElement) => link.textContent.includes('evil.com')

test.each([
  ['its url', { url: 'http://localhost/.//evil.com', route: '/.//evil.com' }],
  ['its route', { url: 'x', route: '//evil.com' }],
  ['its route, with a backslash', { url: 'x', route: '/\\evil.com' }],
  ['its route, with a tab', { url: 'x', route: '/\t/evil.com' }],
  ['its route, with a line break', { url: 'x', route: '/\n/evil.com' }],
])('a page link that would leave the app, from %s, is no link', async (_, fields) => {
  fakeServer([comment(fields)])
  openPanel('all')
  renderWidget()

  await screen.findByText('Make the title bigger')
  // Shown, but as text.
  expect(document.body.textContent).toContain('evil.com')
  expect(screen.queryAllByRole('link').some(leaves)).toBe(false)
})

test("an element's chip does not leave the app for a page elsewhere", async () => {
  visit('/other')
  const assign = navigations()
  fakeServer([comment({ url: 'http://localhost/.//evil.com', element: TITLE })])
  openPanel('all', 'c1')
  renderWidget()

  fireEvent.click(await screen.findByTestId('an-element'))
  expect(assign).not.toHaveBeenCalled()
})

test("an element's chip opens its page on the app", async () => {
  visit('/other')
  const assign = navigations()
  fakeServer([comment({ url: `${window.location.origin}/cards?tab=2`, element: TITLE })])
  openPanel('all', 'c1')
  renderWidget()

  fireEvent.click(await screen.findByTestId('an-element'))
  expect(assign).toHaveBeenCalledWith(`${window.location.origin}/cards?tab=2`)
})
