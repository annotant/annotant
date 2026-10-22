// Mounts the widget, from the extension's own bundle, in this content script's
// isolated world, when a Code Buddy server watches this page's origin. A page
// no server watches gets nothing: the background asks the ports, not the page.
void (async () => {
  const server = await chrome.runtime.sendMessage({ find: location.origin })
  if (!server) return
  // The widget reads it before its first request (widget/src/server.ts).
  globalThis.codeBuddyServer = server.url
  await import(chrome.runtime.getURL('dist/widget.js'))
})().catch((error) => {
  // No bundle (build it, see README.md), or the background could not answer.
  console.warn('Code Buddy could not mount the widget:', error)
})
