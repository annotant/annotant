import {
  createContext,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'

const PathContext = createContext('/')

/** The current path, kept in sync with the browser's history. */
export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return <PathContext value={path}>{children}</PathContext>
}

export const usePath = () => useContext(PathContext)

function navigate(to: string) {
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

interface LinkProps {
  to: string
  className?: string
  children: ReactNode
}

export function Link({ to, className, children }: LinkProps) {
  const current = usePath() === to
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  )
}
