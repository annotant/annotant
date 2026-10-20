// Spike for #100, not for merging: the panel in a Document Picture-in-Picture window.
import { PAGE_CSS, WIDGET_CSS } from './styles'

interface PictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
  preferInitialWindowPlacement?: boolean
}

interface DocumentPictureInPicture extends EventTarget {
  readonly window: Window | null
  requestWindow(options?: PictureInPictureOptions): Promise<Window>
}

declare global {
  interface Window {
    /** Chromium 116 and later only. */
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export interface Popout {
  window: Window
  /** Where the panel renders, through a portal: in a shadow root, as in the page. */
  container: HTMLElement
}

/** The browser can open the panel in a window of its own. */
export const canPopOut = () => !!window.documentPictureInPicture

/**
 * Opens the always-on-top window, from a click only (it needs a user
 * activation), with the widget's styles; `onClose` runs once it is closed,
 * by the reader or with the page.
 */
export async function popOut(width: number, onClose: () => void): Promise<Popout> {
  const pip = window.documentPictureInPicture
  if (!pip) throw new Error('This browser cannot open the panel in a window.')
  const opened = await pip
    .requestWindow({ width, height: Math.min(window.screen.availHeight, 720) })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? `: ${error.message}` : ''
      throw new Error(`Could not open the panel in a window${reason}`)
    })
  try {
    return { window: opened, container: mountIn(opened, onClose) }
  } catch (error) {
    // Never an empty window left on top.
    opened.close()
    throw error
  }
}

function mountIn(opened: Window, onClose: () => void): HTMLElement {
  const { document } = opened
  document.title = 'Code Buddy'
  // The fonts, which a shadow root ignores, go in the window's own document.
  const pageStyle = document.createElement('style')
  pageStyle.textContent = PAGE_CSS
  document.head.append(pageStyle)
  const host = document.createElement('code-buddy-widget')
  document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  const container = document.createElement('div')
  shadow.append(style, container)
  opened.addEventListener('pagehide', onClose, { once: true })
  return container
}
