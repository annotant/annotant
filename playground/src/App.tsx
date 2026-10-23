import type { ComponentType } from 'react'
import { Link, Router, usePath } from './router'
import { useTheme } from './theme'
import { Contact } from './pages/Contact'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { Retailers } from './pages/Retailers'

const PAGES: Record<string, ComponentType> = {
  '/': Home,
  '/retailers': Retailers,
  '/contact': Contact,
}

const THEME_LABEL = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
}

function Header() {
  const { theme, next } = useTheme()
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          Northwind Roasters
        </Link>
        <nav aria-label="Main">
          <Link to="/">Home</Link>
          <Link to="/retailers">Retailers</Link>
          <Link to="/contact">Contact</Link>
        </nav>
        <button type="button" className="btn btn--ghost btn--sm" onClick={next}>
          {THEME_LABEL[theme]}
        </button>
      </div>
    </header>
  )
}

function Page() {
  const Current = PAGES[usePath()] ?? NotFound
  return <Current />
}

export function App() {
  return (
    <Router>
      <Header />
      <main className="container main">
        <Page />
      </main>
      <footer className="footer">
        <div className="container">
          © Northwind Roasters, a fake shop for trying Annotant. Nothing here is for sale.
        </div>
      </footer>
    </Router>
  )
}
