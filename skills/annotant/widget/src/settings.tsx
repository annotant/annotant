import { useEffect, useRef, useState } from 'react'
import {
  fetchSettings,
  saveSettings,
  type AutoModel,
  type Choice,
  type Effort,
  type FixedModel,
  type ModelsSetting,
  type ProjectSettings,
} from './api'
import {
  Button,
  IconButton,
  Select,
  Spinner,
  Textarea,
  Toggle,
  toast,
  type SelectOption,
} from './ui'

type Label = 'trivial' | 'standard' | 'hard'
type Strategy = 'auto' | 'fixed'
type LabelChoices = Record<Label, Choice<AutoModel>>
type Option<T extends string> = SelectOption<T>

const LABELS: Option<Label>[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'standard', label: 'Standard' },
  { value: 'hard', label: 'Hard' },
]
const AUTO_MODELS: Option<AutoModel>[] = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
]
// The session's model fits one model for every comment, not a label.
const FIXED_MODELS: Option<FixedModel>[] = [
  ...AUTO_MODELS,
  { value: 'inherit', label: "The session's model" },
]
/** `''`: none, the model's own effort. */
const EFFORTS: Option<Effort | ''>[] = [
  { value: '', label: 'Default effort' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
]
/** The server's default, which Auto starts from when the file names none. */
const DEFAULT_LABELS: LabelChoices = {
  trivial: { model: 'haiku' },
  standard: { model: 'sonnet' },
  hard: { model: 'opus' },
}

/** What the dialog would save for a strategy and its choices. */
const draftOf = (strategy: Strategy, labels: LabelChoices, fixed: Choice<FixedModel>) =>
  strategy === 'auto'
    ? ({ strategy, ...labels } as const)
    : ({ strategy, ...fixed } as const)

const sameChoice = (a: Choice<string>, b: Choice<string>) =>
  a.model === b.model && (a.effort ?? '') === (b.effort ?? '')

const sameModels = (a: ModelsSetting, b: ModelsSetting) =>
  a.strategy === 'auto' && b.strategy === 'auto'
    ? LABELS.every(({ value }) => sameChoice(a[value], b[value]))
    : a.strategy === 'fixed' && b.strategy === 'fixed' && sameChoice(a, b)

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
  const [labels, setLabels] = useState<LabelChoices>(DEFAULT_LABELS)
  const [fixed, setFixed] = useState<Choice<FixedModel>>({ model: 'inherit' })
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
      setFixed({ model: models.model, ...(models.effort && { effort: models.effort }) })
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
 * The model and effort each comment's agent starts on: Auto, the classifier's
 * label then a choice per label, or Fixed, one choice. A `models` written by
 * hand that the dialog cannot show is shown as written, to change in the file.
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
  labels: LabelChoices
  onLabels: (labels: LabelChoices) => void
  fixed: Choice<FixedModel>
  onFixed: (choice: Choice<FixedModel>) => void
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
              ? "Auto: a classifier sorts each comment, and its label picks the agent's model and effort."
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
              <ChoicePicker
                key={value}
                id={`an-model-${value}`}
                label={label}
                models={AUTO_MODELS}
                choice={labels[value]}
                onChange={(choice) => onLabels({ ...labels, [value]: choice })}
              />
            ))
          ) : (
            <ChoicePicker
              id="an-model-fixed"
              label="Every comment"
              models={FIXED_MODELS}
              choice={fixed}
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

/** A row: its name, the model, and the effort it runs at. */
function ChoicePicker<M extends string>({
  id,
  label,
  models,
  choice,
  onChange,
}: {
  id: string
  label: string
  models: Option<M>[]
  choice: Choice<M>
  onChange: (choice: Choice<M>) => void
}) {
  return (
    <div className="an-settings-model">
      <label htmlFor={id}>{label}</label>
      <Select
        id={id}
        value={choice.model}
        options={models}
        onChange={(model) => onChange({ ...choice, model })}
      />
      <Select
        aria-label={`${label}: effort`}
        value={choice.effort ?? ''}
        options={EFFORTS}
        onChange={(effort) =>
          onChange(effort ? { model: choice.model, effort } : { model: choice.model })
        }
      />
    </div>
  )
}
