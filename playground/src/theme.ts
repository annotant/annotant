import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

const KEY = 'northwind-theme'
const ORDER: Theme[] = ['system', 'light', 'dark']

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** The chosen theme, applied to the document and remembered in this browser. */
export function useTheme() {
  const [theme, setTheme] = useState(stored)
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Private windows may refuse storage: the theme lasts until the next load.
    }
  }, [theme])
  const next = () =>
    setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system')
  return { theme, next }
}
