import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { NewImage } from '../domain'
import { imageBytes, imageFiles, pick, preview, readImages } from '../images'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { toast } from './Toasts'

/**
 * The message box at the end of the panel's body: Enter sends, Shift+Enter breaks the
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

/** After the icon button's: the attach and remove buttons override its size and colours. */
export const COMPOSER_CSS = `
.an-composer-box { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid var(--cb-border); border-radius: 12px; background: var(--cb-surface); transition: border-color .15s; }
.an-composer-box:focus-within { border-color: var(--cb-accent); }
/* The images pasted or dropped, on a row of their own above the text. */
.an-attachments { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.an-attachment { position: relative; }
.an-attachment img { display: block; width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--cb-border); border-radius: 6px; }
.an-attachment-remove { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 999px; background: var(--cb-text); color: var(--cb-surface); }
.an-attachment-remove:hover { background: var(--cb-red); }
.an-attachment-remove svg { width: 12px; height: 12px; }
/* The target slot, above the images and the text: what to point at, or the one target's card. */
.an-target-slot { flex-basis: 100%; min-width: 0; padding-bottom: 6px; border-bottom: 1px solid var(--cb-border); }
.an-attach { flex-shrink: 0; width: 36px; height: 36px; }
.an-composer-box textarea { flex: 1; min-width: 0; min-height: 36px; max-height: 160px; padding: 7px 0; border: 0; outline: none; resize: none; overflow-y: auto; background: transparent; font-size: 15px; line-height: 1.45; }
.an-composer-box textarea::placeholder { color: var(--cb-muted); }
.an-send { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: var(--cb-accent); color: var(--cb-on-accent); cursor: pointer; transition: background .15s; }
.an-send:hover { background: var(--cb-accent-strong); }
.an-send:disabled { cursor: default; background: var(--cb-accent-weak); color: var(--cb-disabled); }
.an-send svg { width: 18px; height: 18px; }
`
