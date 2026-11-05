import { type TextareaHTMLAttributes, forwardRef } from 'react'

/** A text field of several lines, which the reader can make taller. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`an-textarea ${className}`} {...props} />
})

export const TEXTAREA_CSS = `
.an-textarea {
  width: 100%; min-height: 96px; resize: vertical; padding: 10px 12px;
  border: 1px solid var(--cb-border); border-radius: var(--cb-radius);
  background: var(--cb-surface-2); outline: none;
}
.an-textarea:focus { border-color: var(--cb-accent); }
.an-textarea::placeholder { color: var(--cb-muted); font-style: italic; }
`
