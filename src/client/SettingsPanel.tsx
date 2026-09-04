import { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export interface SubagentSettingsSection {
  provider?: string
  model?: string
  reasoningEffort?: string
}

export type SaveOutcome =
  | { status: 'saved' }
  | { status: 'not-applied' }
  | { status: 'error'; message: string }

export interface SubagentSettingsInjected {
  hooks: {
    configurableSubagentSettings: SettingsScope<SubagentSettingsSection>
  }
  save(values: Required<SubagentSettingsSection>): Promise<SaveOutcome>
}

export type SubagentSettingsPanelProps =
  PropsRuntime<'settings.section'> & InjectFace<SubagentSettingsInjected>

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '16px 20px',
    maxWidth: '720px',
  } as const,
  title: {
    margin: 0,
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary)',
  },
  copy: {
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-tertiary)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(150px, 210px) minmax(260px, 1fr)',
    gap: '12px 16px',
    alignItems: 'center',
    padding: '14px',
    background: 'var(--dsw-alias-bg-layer-0)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '10px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--dsw-alias-label-secondary)',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    boxSizing: 'border-box',
    fontSize: '13px',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '7px',
  } as const,
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  button: {
    padding: '7px 14px',
    fontSize: '13px',
    border: 'none',
    borderRadius: '6px',
    color: 'var(--dsw-alias-label-primary-foreground)',
    background: 'var(--dsw-alias-button-primary-fill)',
    cursor: 'pointer',
  },
  disabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  status: {
    margin: 0,
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
  },
  error: {
    margin: 0,
    fontSize: '12px',
    color: 'var(--dsw-alias-interactive-bg-hover-danger)',
  },
}

const EMPTY_VALUES: Required<SubagentSettingsSection> = {
  provider: '',
  model: '',
  reasoningEffort: '',
}

export function SubagentSettingsPanel(props: SubagentSettingsPanelProps) {
  const snapshot = props.useConfigurableSubagentSettings(value => value)
  const stored: Required<SubagentSettingsSection> = {
    provider: snapshot.value?.provider ?? '',
    model: snapshot.value?.model ?? '',
    reasoningEffort: snapshot.value?.reasoningEffort ?? '',
  }
  const [draft, setDraft] = useState<Required<SubagentSettingsSection>>(EMPTY_VALUES)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)

  useEffect(() => {
    if (!dirty) setDraft(stored)
  }, [snapshot.value, dirty])

  const update = (field: keyof SubagentSettingsSection, value: string): void => {
    setDraft(current => ({ ...current, [field]: value }))
    setDirty(true)
    setOutcome(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setOutcome(null)
    try {
      const result = await props.save(draft)
      setOutcome(result)
      if (result.status === 'saved') setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const ready = snapshot.status === 'ready'
  const disabled = !ready || saving || !dirty

  return <div style={styles.root}>
    <h2 style={styles.title}>Sub-agent defaults</h2>
    <p style={styles.copy}>
      These values apply when a subagent call does not select its own route. Leave provider and model blank to inherit the parent route. Leave reasoning effort blank to use the model provider's default.
    </p>
    <div style={styles.grid}>
      <label htmlFor="configurable-subagent-provider" style={styles.label}>Provider</label>
      <input
        id="configurable-subagent-provider"
        style={styles.input}
        value={draft.provider}
        placeholder="deepseek-official"
        disabled={!ready || saving}
        onChange={event => update('provider', event.currentTarget.value)}
      />

      <label htmlFor="configurable-subagent-model" style={styles.label}>Model</label>
      <input
        id="configurable-subagent-model"
        style={styles.input}
        value={draft.model}
        placeholder="deepseek-v4-flash"
        disabled={!ready || saving}
        onChange={event => update('model', event.currentTarget.value)}
      />

      <label htmlFor="configurable-subagent-effort" style={styles.label}>Reasoning effort</label>
      <input
        id="configurable-subagent-effort"
        style={styles.input}
        value={draft.reasoningEffort}
        placeholder="off, low, high, max, or another adapter value"
        disabled={!ready || saving}
        onChange={event => update('reasoningEffort', event.currentTarget.value)}
      />
    </div>
    <p style={styles.copy}>
      Per-call provider and model must be supplied together. A call can set reasoning_effort to provider-default to bypass the saved effort.
    </p>
    <div style={styles.actions}>
      <button
        type="button"
        style={{ ...styles.button, ...(disabled ? styles.disabled : {}) }}
        disabled={disabled}
        onClick={() => { void save() }}
      >
        {saving ? 'Saving…' : 'Save defaults'}
      </button>
      {outcome?.status === 'saved' && <p style={styles.status}>Saved.</p>}
      {outcome?.status === 'not-applied' && <p style={styles.error}>The host did not apply all values.</p>}
      {outcome?.status === 'error' && <p style={styles.error}>{outcome.message}</p>}
    </div>
  </div>
}
