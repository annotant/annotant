import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

if (process.env.NODE_ENV === 'development') {
  const script = document.createElement('script')
  script.type = 'module'
  script.src = 'http://127.0.0.1:4591/widget.js'
  script.dataset.annotantLoader = ''
  document.head.append(script)
}

if (process.env.NODE_ENV === 'development') {
  // serve.mjs rebuilds on every change: reload to show it.
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
