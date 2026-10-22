import { createRoot } from 'react-dom/client'
import App from './App'
import { PAGE_CSS, WIDGET_CSS } from './styles'

const HOST = 'annotant-widget'

function mount() {
  if (document.querySelector(HOST)) return
  const host = document.createElement(HOST)
  host.setAttribute('data-annotant', '')
  document.body.append(host)

  const pageStyle = document.createElement('style')
  pageStyle.setAttribute('data-annotant', '')
  pageStyle.textContent = PAGE_CSS
  document.head.append(pageStyle)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  const container = document.createElement('div')
  shadow.append(style, container)
  createRoot(container).render(<App root={document.body} />)
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
