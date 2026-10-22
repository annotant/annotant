// Finds the Code Buddy server that watches an origin: each server answers
// /api/health with the origins of its project's dev app. It asks 60 ports,
// the playground's (4590) and those init suggests (from 4599): a server on
// another one is not found. A port that does not answer with JSON has none.
const PORTS = Array.from({ length: 60 }, (_, i) => 4590 + i)

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok ? { port, ...(await response.json()) } : undefined
  } catch {
    return undefined
  }
}

async function find(origin) {
  const servers = await Promise.all(PORTS.map(health))
  const server = servers.find((found) => found?.origins?.includes(origin))
  return server && { url: `http://127.0.0.1:${server.port}/`, version: server.version }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (typeof message?.find !== 'string') return false
  // find() never rejects: a port that fails to answer is no server.
  void find(message.find).then(reply)
  return true
})
