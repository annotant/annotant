import {
  type ButtonHTMLAttributes,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  Component,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { NewImage, Status } from './domain'
import { imageBytes, imageFiles, pick, preview, readImages } from './images'

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
  'collapse-horizontal': 'M12 4v16M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  send: 'M4 12l16-8-6 16-3-6zM11 14l9-10',
  'file-text': 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  pencil: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  'file-plus': 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
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
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
} as const

export type IconName = keyof typeof PATHS

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

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary'
  small?: boolean
  icon?: IconName
}

export function Button({
  variant = 'primary',
  small,
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`an-btn an-btn--${variant} ${small ? 'an-btn--sm' : ''} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  danger?: boolean
  /** The keyboard shortcut doing the same, shown in the tooltip. */
  keys?: string
}

export function IconButton({
  icon,
  label,
  danger,
  keys,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      className={`an-icon-btn ${danger ? 'an-icon-btn--danger' : ''} ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
  )
}

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  /** In progress: the button says Cancel after its icon. */
  active?: boolean
}

/**
 * A tool of the dock: its icon alone, or Cancel while it is in progress. The
 * same button either way, so it keeps the focus.
 */
export function ToolButton({
  icon,
  label,
  active,
  className = '',
  ...props
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={active ? undefined : label}
      title={active ? undefined : label}
      className={`an-btn an-btn--secondary an-btn--sm an-tool ${active ? '' : 'an-tool--idle'} ${className}`}
      {...props}
    >
      <Icon name={icon} />
      {active && 'Cancel'}
    </button>
  )
}

export function Chip({
  tone,
  small = false,
  children,
}: {
  tone: Status
  /** The debug panel's: smaller, beside a line of text. */
  small?: boolean
  children: ReactNode
}) {
  return (
    <span className={`an-chip an-chip--${tone}${small ? ' an-chip--small' : ''}`}>
      {children}
    </span>
  )
}

/**
 * The date and time (or what `options` asks for) in the reader's preferred
 * languages (`navigator.languages`), not the browser's interface one: `Intl`
 * takes the first it supports. An empty list, or one `Intl` rejects (a tag the
 * page made up), → the default locale.
 */
export function dateFormat(
  languages: readonly string[] | undefined = navigator.languages,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
) {
  try {
    return new Intl.DateTimeFormat(languages?.length ? languages : undefined, options)
  } catch {
    return new Intl.DateTimeFormat(undefined, options)
  }
}

/** Like `dateFormat`, for how long ago: _5 min ago_, _yesterday_. */
function relativeFormat(languages: readonly string[] | undefined) {
  const options: Intl.RelativeTimeFormatOptions = { numeric: 'auto', style: 'short' }
  try {
    return new Intl.RelativeTimeFormat(languages?.length ? languages : undefined, options)
  } catch {
    return new Intl.RelativeTimeFormat(undefined, options)
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long before `now` `date` is, in the reader's languages: _now_ under a
 * minute (or ahead of `now`: another clock), then minutes, hours, and whole
 * 24-hour days (_yesterday_, _2 days ago_); from a week on, the short date
 * alone, without the time.
 */
export function relativeDate(
  date: Date,
  now: number,
  languages: readonly string[] | undefined = navigator.languages,
) {
  const ago = Math.max(0, now - date.getTime())
  if (ago >= 7 * DAY) return dateFormat(languages, { dateStyle: 'short' }).format(date)
  const relative = relativeFormat(languages)
  if (ago < MINUTE) return relative.format(0, 'second')
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute')
  if (ago < DAY) return relative.format(-Math.floor(ago / HOUR), 'hour')
  return relative.format(-Math.floor(ago / DAY), 'day')
}

// Built on the first date shown, then kept for the page's life.
let dates: Intl.DateTimeFormat | undefined

export function DateTime({
  at,
  now,
  className,
}: {
  at: string
  /** Given, the date shows relative to it, the full one in the tooltip. */
  now?: number
  className?: string
}) {
  const date = new Date(at)
  // `format` throws on an invalid date: a hand-edited comments file shows it as is.
  if (Number.isNaN(date.getTime())) {
    return (
      <time className={className} dateTime={at}>
        {at}
      </time>
    )
  }
  const full = (dates ??= dateFormat()).format(date)
  return now === undefined ? (
    <time className={className} dateTime={at}>
      {full}
    </time>
  ) : (
    <time className={className} dateTime={at} title={full}>
      {relativeDate(date, now)}
    </time>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="an-spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity=".2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`an-textarea ${className}`} {...props} />
})

/**
 * The message box at the panel's foot: Enter sends, Shift+Enter breaks the
 * line. An image pasted, dropped or chosen with its button is attached to the
 * message, shown as a thumbnail until it is sent; there is no count limit.
 */
export function Composer({
  value,
  placeholder,
  disabled,
  autoFocus,
  sendLabel = 'Send',
  images,
  target,
  targeted = false,
  onChange,
  onSubmit,
  onEscape,
  onAttach,
  onDetach,
}: {
  value: string
  placeholder: string
  disabled: boolean
  autoFocus?: boolean
  sendLabel?: string
  images: NewImage[]
  /** The message's target slot, above the text: what in the page it is about. */
  target?: ReactNode
  /** The message holds a target that may go without words: an element, or a reply's area. */
  targeted?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onEscape?: () => void
  /** Without it, the box takes no image. */
  onAttach?: (images: NewImage[]) => void
  /** Removes the attached image at `index`. */
  onDetach?: (index: number) => void
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  // Grows with its text up to the CSS max-height, then scrolls.
  useLayoutEffect(() => {
    const textarea = box.current
    if (!textarea) return
    textarea.style.height = 'auto'
    // Empty, it keeps the CSS height: one line.
    if (value) textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])
  // The images being read, not attached yet, and their bytes: counted against
  // the limits, and the message waits for them.
  const reading = useRef({ count: 0, bytes: 0 })
  const [pending, setPending] = useState(0)
  const chooser = useRef<HTMLInputElement>(null)
  const blocked =
    disabled || pending > 0 || (!value.trim() && !images.length && !targeted)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!blocked) onSubmit()
  }
  const attaching = !!onAttach && !disabled
  // Images read once the box is gone are its draft's, or its thread's, which
  // the reader left: keyed by either, the next box is another one.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const add = async (files: File[]) => {
    if (!onAttach) return
    const attached = images.reduce((sum, image) => sum + imageBytes(image), 0)
    const picked = pick(
      attached + reading.current.bytes,
      files,
      images.length + reading.current.count,
    )
    if (picked.refused) toast(picked.refused, true)
    if (!picked.files.length) return
    const count = picked.files.length
    const bytes = picked.files.reduce((sum, file) => sum + file.size, 0)
    reading.current = {
      count: reading.current.count + count,
      bytes: reading.current.bytes + bytes,
    }
    setPending((current) => current + count)
    let read: NewImage[] | undefined
    try {
      read = await readImages(picked.files)
    } catch {
      toast('The image could not be read.', true)
    } finally {
      reading.current = {
        count: reading.current.count - count,
        bytes: reading.current.bytes - bytes,
      }
      setPending((current) => current - count)
    }
    if (read && mounted.current) onAttach(read)
  }
  // A file dragged over the box is its own, busy or not: the browser would
  // open it in the app's place.
  const onDragOver = (event: DragEvent) => {
    if (!onAttach || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = attaching ? 'copy' : 'none'
  }
  const onDrop = (event: DragEvent) => {
    if (!onAttach || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    const files = imageFiles(event.dataTransfer.files)
    if (!attaching) toast('Wait for the message to be sent.', true)
    else if (files.length) void add(files)
    else toast('Only images can be attached.', true)
  }
  return (
    <form
      className="an-composer-box"
      onSubmit={submit}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {target && <div className="an-target-slot">{target}</div>}
      {images.length > 0 && (
        <div className="an-attachments" data-testid="an-attachments">
          {images.map((image, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- the same image twice is two attachments: only its place tells them apart
            <div key={index} className="an-attachment">
              <img src={preview(image)} alt={`Attached image ${index + 1}`} />
              <IconButton
                icon="x"
                label={`Remove image ${index + 1}`}
                className="an-attachment-remove"
                onClick={() => onDetach?.(index)}
              />
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={box}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const files = imageFiles(event.clipboardData.files)
          if (!attaching || !files.length || pastesText(event.clipboardData, files))
            return
          event.preventDefault()
          void add(files)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            // The box's, not the panel's around it.
            if (onEscape) event.preventDefault()
            return onEscape?.()
          }
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
      />
      {onAttach && (
        <>
          <IconButton
            icon="image"
            label="Attach images"
            className="an-attach"
            disabled={!attaching}
            onClick={() => chooser.current?.click()}
          />
          <input
            ref={chooser}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="an-image-input"
            onChange={(event) => {
              const files = imageFiles(event.currentTarget.files ?? [])
              // Chosen again, the same file is a change too.
              event.currentTarget.value = ''
              if (files.length) void add(files)
              else if (event.currentTarget.files?.length)
                toast('Only images can be attached.', true)
            }}
          />
        </>
      )}
      <button
        type="submit"
        className="an-send"
        aria-label={sendLabel}
        title={sendLabel}
        disabled={blocked}
      >
        <Icon name="arrow-up" />
      </button>
    </form>
  )
}

/**
 * Whether a paste brings text of its own beside its images: cells copied from
 * a spreadsheet come with a picture of them, which the text wins over. A file
 * copied brings only its name as text, and the image goes in.
 */
function pastesText(clipboard: DataTransfer, files: File[]) {
  const text = clipboard.getData('text/plain').trim()
  return !!text && !files.some((file) => file.name === text)
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="an-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

/** Arrow keys step through a radio group, wrapping; Home and End jump to its ends. */
const RADIO_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
}

/**
 * A radio group as screen readers expect it: one Tab stop, the checked radio,
 * and arrow keys that check and focus the next one.
 */
export function Toggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+Left and the like are the browser's, not the group's.
    const step =
      !event.altKey && !event.ctrlKey && !event.metaKey && RADIO_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const current = options.findIndex((option) => option.value === value)
    const next = step(Math.max(current, 0), options.length)
    const option = options[next]
    if (!option) return
    onChange(option.value)
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
  return (
    <div className="an-toggle" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface Toast {
  id: number
  text: string
  error?: boolean
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function toast(text: string, error = false) {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, error }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((entry) => entry.id !== id)
    emit()
  }, 3500)
}

export function Toasts() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
  )
  const list = (error: boolean) =>
    current
      .filter((entry) => Boolean(entry.error) === error)
      .map((entry) => (
        <div
          key={entry.id}
          className={`an-toast ${entry.error ? 'an-toast--error' : ''}`}
        >
          {entry.text}
        </div>
      ))
  // Both always there, even empty: a screen reader only announces what
  // changes in a live region it already knew. Side by side, not nested, so
  // an error is announced once, and interrupts.
  return (
    <div className="an-toasts an-live">
      <div role="status">{list(false)}</div>
      <div role="alert">{list(true)}</div>
    </div>
  )
}

/**
 * Draws `children()`, or `fallback` once that throws: one comment the widget
 * cannot draw never takes the whole widget down. It tries again when
 * `resetOn` changes, as when the server sends that comment anew.
 */
export class Boundary extends Component<
  { fallback: ReactNode; resetOn?: unknown; children: () => ReactNode },
  { failed: boolean; resetOn?: unknown }
> {
  override state = { failed: false, resetOn: this.props.resetOn }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: { resetOn?: unknown },
    state: { resetOn?: unknown },
  ) {
    return props.resetOn === state.resetOn
      ? null
      : { failed: false, resetOn: props.resetOn }
  }

  override render() {
    return this.state.failed ? this.props.fallback : <Draw render={this.props.children} />
  }
}

/** Calls `render` in a component of its own, for the boundary above to catch what it throws. */
function Draw({ render }: { render: () => ReactNode }) {
  return render()
}
