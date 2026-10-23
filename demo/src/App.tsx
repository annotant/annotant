import { Features } from './Features'
import { Hero } from './Hero'

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--forest)" />
      <path d="M16 25V13" stroke="var(--cream)" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 17c-5 0-7-3-7-7 5 0 7 3 7 7Z" fill="var(--sage)" />
      <path d="M16 15c4 0 6-3 6-6-4 0-6 3-6 6Z" fill="var(--cream)" />
    </svg>
  )
}

function Header() {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="/" className="brand">
          <Logo />
          Mossbloom
        </a>
        <nav aria-label="Main">
          <a href="#features">Features</a>
          <a href="#features">Pricing</a>
          <a href="#features">Journal</a>
        </nav>
        <a href="#features" className="header-cta">
          Sign in
        </a>
      </div>
    </header>
  )
}

export function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
      </main>
      <footer className="footer">
        <div className="container">
          Mossbloom is a made-up app, built to film Annotant. No plant was harmed.
        </div>
      </footer>
    </>
  )
}
