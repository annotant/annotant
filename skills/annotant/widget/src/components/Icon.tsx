const PATHS = {
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  chats: 'M3 4h12v9H8l-5 4zM9 16v1h7l5 4V8h-3',
  chat: 'M4 5h16v11H9l-5 4z',
  cursor: 'M6 3l13 10-6 1-3 6z',
  frame: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  'expand-horizontal': 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  // A window with its panel on that side.
  'panel-left': 'M4 5h16v14H4zM9 5v14',
  'panel-right': 'M4 5h16v14H4zM15 5v14',
  'collapse-horizontal': 'M12 4v16M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  send: 'M4 12l16-8-6 16-3-6zM11 14l9-10',
  'file-text': 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  pencil: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  'file-plus': 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  'file-minus': 'M6 3h8l4 4v14H6zM14 3v4h4M9 14h6',
  copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4',
  search: 'M16 16l4 4M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  lightning: 'M13 3L5 14h6l-1 7 8-11h-6z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  wrench: 'M14 6a4 4 0 0 0-5 5l-5 5 4 4 5-5a4 4 0 0 0 5-5l-3 3-3-3z',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-11',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
  gear: 'M9.8 5.6L10.4 2.6L13.6 2.6L14.2 5.6L15 5.9L17.4 4.2L19.8 6.6L18.1 9L18.4 9.8L21.4 10.4L21.4 13.6L18.4 14.2L18.1 15L19.8 17.4L17.4 19.8L15 18.1L14.2 18.4L13.6 21.4L10.4 21.4L9.8 18.4L9 18.1L6.6 19.8L4.2 17.4L5.9 15L5.6 14.2L2.6 13.6L2.6 10.4L5.6 9.8L5.9 9L4.2 6.6L6.6 4.2L9 5.9zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'git-branch':
    'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
} as const

export type IconName = keyof typeof PATHS

/** One of the widget's line icons, in the text's colour, sized by its container's CSS. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
