import { useEffect, useRef, useState } from 'react'
import { fetchSettings, saveSettings, type ProjectSettings } from './api'
import { Button, IconButton, Spinner, Textarea, toast } from './components'

/**
 * The project's settings, over the panel: today the instructions for the
 * agents. Saving writes them to `.annotant.json` at once (lib/settings.mjs);
 * each agent reads them when it starts, and a follow-up resumes its agent. Escape or ✕ close it.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ProjectSettings | null>()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  // Why the settings could not be read: no server, or its own words.
  const [failed, setFailed] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      const read = await fetchSettings().catch((error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : String(error))
        return null
      })
      if (!live) return
      setSettings(read)
      if (read) setText(read.instructions)
    }
    void load()
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (settings) field.current?.focus()
  }, [settings])

  const saved = settings ? settings.instructions.trim() : ''
  const tooLong = !!settings && text.trim().length > settings.max
  const changed = !!settings && text.trim() !== saved

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveSettings(text)
      setSettings(next)
      setText(next.instructions)
      toast(
        next.instructions.trim()
          ? "Saved: the next comments' agents follow these instructions."
          : "Saved: the next comments' agents get no instructions.",
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="an-settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="an-settings-title"
      data-testid="an-settings"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        // The panel's own Escape would close it.
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="an-header">
        <div className="an-title">
          <h2 id="an-settings-title">Settings</h2>
        </div>
        <IconButton icon="x" label="Close settings" onClick={onClose} />
      </header>
      <div className="an-settings-body">
        {settings === undefined ? (
          <Spinner />
        ) : settings === null ? (
          <p className="an-settings-hint">
            The settings could not be read ({failed}): is a Claude session watching, and
            is <code>.annotant.json</code> valid JSON?
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (changed && !tooLong && !saving) void save()
            }}
          >
            <label htmlFor="an-instructions" className="an-settings-label">
              Instructions for the agents
            </label>
            <p className="an-settings-hint" id="an-instructions-hint">
              What every comment's agent should know about this project: its conventions,
              its design system, the language of its copy, what not to touch. They follow
              it after their own rules.
            </p>
            <p className="an-settings-hint">
              Saved to <code>.annotant.json</code> at once. Each agent reads them when it
              starts: the next comments get them; the agents already working, and a
              follow-up to their comment, keep the ones they had.
            </p>
            <Textarea
              ref={field}
              id="an-instructions"
              aria-describedby="an-instructions-hint"
              rows={8}
              value={text}
              placeholder="We use Tailwind, never inline styles. Copy is in Canadian French."
              onChange={(event) => setText(event.target.value)}
            />
            <div className="an-settings-count" data-over={tooLong || undefined}>
              {text.trim().length} / {settings.max}
            </div>
            <div className="an-settings-actions">
              <Button variant="secondary" small onClick={onClose}>
                Close
              </Button>
              <Button type="submit" small disabled={!changed || tooLong || saving}>
                Save
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
