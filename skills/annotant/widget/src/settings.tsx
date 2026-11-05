import { useEffect, useRef, useState } from 'react'
import {
  fetchSettings,
  saveSettings,
  type AgentModel,
  type ModelsSetting,
  type ProjectSettings,
} from './api'
import { Button, IconButton, Spinner, Textarea, Toggle, toast } from './ui'

type Label = 'trivial' | 'standard' | 'hard'
type Strategy = 'auto' | 'fixed'
type LabelModels = Record<Label, AgentModel>

const LABELS: { value: Label; label: string }[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'standard', label: 'Standard' },
  { value: 'hard', label: 'Hard' },
]
const MODELS: { value: AgentModel; label: string }[] = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'inherit', label: "The session's model" },
]
/** The server's default, which Auto starts from when the file names none. */
const DEFAULT_LABELS: LabelModels = {
  trivial: 'haiku',
  standard: 'inherit',
  hard: 'opus',
}

/** What the dialog would save for a strategy and its models. */
const draftOf = (strategy: Strategy, labels: LabelModels, fixed: AgentModel) =>
  strategy === 'auto'
    ? ({ strategy, ...labels } as const)
    : ({ strategy, model: fixed } as const)

const sameModels = (a: ModelsSetting, b: ModelsSetting) =>
  a.strategy === 'auto' && b.strategy === 'auto'
    ? LABELS.every(({ value }) => a[value] === b[value])
    : a.strategy === 'fixed' && b.strategy === 'fixed' && a.model === b.model

/**
 * The project's settings, over the panel: the instructions for the agents and
 * the model they start on. Saving writes them to `.annotant.json` at once
 * (lib/settings.mjs); the hooks read it for each agent they start, and a
 * follow-up resumes its agent. Escape or ✕ close it.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ProjectSettings | null>()
  const [text, setText] = useState('')
  const [strategy, setStrategy] = useState<Strategy>('auto')
  // Each strategy's own choice, kept while the reader switches between them.
  const [labels, setLabels] = useState<LabelModels>(DEFAULT_LABELS)
  const [fixed, setFixed] = useState<AgentModel>('inherit')
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
      showSaved(read)
    }
    void load()
    return () => {
      live = false
    }
  }, [])
  // Focused once, as the settings come: not again after a save.
  const loaded = settings !== undefined
  useEffect(() => {
    if (loaded) field.current?.focus()
  }, [loaded])

  /** The dialog shows `read`, as the server holds it now. */
  function showSaved(read: ProjectSettings | null) {
    setSettings(read)
    if (!read) return
    setText(read.instructions)
    const models = read.models
    if (models?.strategy === 'auto') {
      setStrategy('auto')
      setLabels({ trivial: models.trivial, standard: models.standard, hard: models.hard })
    } else if (models?.strategy === 'fixed') {
      setStrategy('fixed')
      setFixed(models.model)
    }
  }

  const saved = settings ? settings.instructions.trim() : ''
  const tooLong = !!settings && text.trim().length > settings.max
  const instructionsChanged = !!settings && text.trim() !== saved
  const draft = draftOf(strategy, labels, fixed)
  // A `models` written by hand is the file's to change: never sent.
  const editableModels =
    settings?.models && settings.models.strategy !== 'custom'
      ? settings.models
      : undefined
  const modelsChanged = !!editableModels && !sameModels(draft, editableModels)
  const changed = instructionsChanged || modelsChanged

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveSettings({
        ...(instructionsChanged && { instructions: text }),
        ...(modelsChanged && { models: draft }),
      })
      showSaved(next)
      toast(
        !instructionsChanged
          ? "Saved: the next comments' agents start on these models."
          : modelsChanged
            ? "Saved: the next comments' agents follow these settings."
            : next.instructions.trim()
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
            {settings.models && (
              <ModelSection
                models={settings.models}
                strategy={strategy}
                onStrategy={setStrategy}
                labels={labels}
                onLabels={setLabels}
                fixed={fixed}
                onFixed={setFixed}
              />
            )}
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

/**
 * The model each comment's agent starts on: Auto, the classifier's label then
 * a model per label, or Fixed, one model. A `models` written by hand that the
 * dialog cannot show is shown as written, to change in the file.
 */
function ModelSection({
  models,
  strategy,
  onStrategy,
  labels,
  onLabels,
  fixed,
  onFixed,
}: {
  models: ModelsSetting
  strategy: Strategy
  onStrategy: (strategy: Strategy) => void
  labels: LabelModels
  onLabels: (labels: LabelModels) => void
  fixed: AgentModel
  onFixed: (model: AgentModel) => void
}) {
  return (
    <section className="an-settings-section" aria-labelledby="an-models-title">
      <h3 id="an-models-title" className="an-settings-label">
        Model
      </h3>
      {models.strategy === 'custom' ? (
        <p className="an-settings-hint">
          <code>models</code> in <code>.annotant.json</code> is <code>{models.text}</code>
          , written by hand: change it in the file.
        </p>
      ) : (
        <>
          <p className="an-settings-hint">
            {strategy === 'auto'
              ? "Auto: a classifier sorts each comment, and its label picks the agent's model."
              : 'Fixed: every comment runs on this model, without the classifier.'}
          </p>
          <Toggle
            label="How the model is picked"
            value={strategy}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={onStrategy}
          />
          {strategy === 'auto' ? (
            LABELS.map(({ value, label }) => (
              <ModelPicker
                key={value}
                id={`an-model-${value}`}
                label={label}
                value={labels[value]}
                onChange={(model) => onLabels({ ...labels, [value]: model })}
              />
            ))
          ) : (
            <ModelPicker
              id="an-model-fixed"
              label="Every comment"
              value={fixed}
              onChange={onFixed}
            />
          )}
          <p className="an-settings-hint">
            The next comments&apos; agents start on it; those already working, and a
            follow-up to their comment, keep their model.
          </p>
        </>
      )}
    </section>
  )
}

function ModelPicker({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: AgentModel
  onChange: (model: AgentModel) => void
}) {
  return (
    <div className="an-settings-model">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="an-select"
        value={value}
        onChange={(event) => {
          const model = MODELS.find((one) => one.value === event.target.value)
          if (model) onChange(model.value)
        }}
      >
        {MODELS.map((model) => (
          <option key={model.value} value={model.value}>
            {model.label}
          </option>
        ))}
      </select>
    </div>
  )
}
