import { useEffect, useMemo, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** One provider/model route, as the allowlist stores it. */
export interface ModelRoute {
  provider: string
  model: string
}

/** One selectable provider/model pair offered by the live catalog. */
export interface ModelChoice extends ModelRoute {
  /** Provider display name. */
  providerName: string
  /** Model display name (falls back to the model id). */
  modelName: string
  /** Provider-supplied description, when it sent one. */
  description?: string
}

/**
 * Answer of one catalog read. A failure is reported rather than thrown: this
 * panel's own settings stay editable when the model directory is unreachable.
 */
export type CatalogOutcome =
  | { status: 'ready'; choices: ModelChoice[]; failures: string[] }
  | { status: 'error'; message: string }

export interface SubagentSettingsSection {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxConcurrent?: number
  allowedModels?: ModelRoute[]
  singleLevel?: boolean
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
  /** Read the live provider/model catalog that backs the allowlist picker. */
  loadModels(): Promise<CatalogOutcome>
}

export type SubagentSettingsPanelProps =
  PropsRuntime<'settings.section'> & InjectFace<SubagentSettingsInjected>

/** Concurrency bounds, mirrored from the host schema. */
export const MIN_CONCURRENT = 1
export const MAX_CONCURRENT = 8
export const DEFAULT_CONCURRENT = 4
/** How many catalog tags render at once, so a huge catalog stays responsive. */
const MAX_VISIBLE_TAGS = 60

/** Both halves of a route, or undefined when either is blank. */
export function routeOf(value: unknown): ModelRoute | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as { provider?: unknown; model?: unknown }
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  return provider === '' || model === '' ? undefined : { provider, model }
}

/** Stable identity of one route. */
export function routeKey(route: ModelRoute): string {
  return `${route.provider}\u0000${route.model}`
}

/** The stored allowlist, normalized the way the host reads it. */
export function normaliseRoutes(section: SubagentSettingsSection | undefined): ModelRoute[] {
  const stored = Array.isArray(section?.allowedModels) ? section.allowedModels : []
  const routes: ModelRoute[] = []
  for (const entry of stored) {
    const route = routeOf(entry)
    if (route === undefined) continue
    if (routes.some(candidate => routeKey(candidate) === routeKey(route))) continue
    routes.push(route)
  }
  return routes
}

/** Whether two allowlists carry the same routes in the same order. */
export function sameRoutes(a: readonly ModelRoute[], b: readonly ModelRoute[]): boolean {
  return a.length === b.length && a.every((route, index) => {
    const other = b[index]
    return other !== undefined && route.provider === other.provider && route.model === other.model
  })
}

/**
 * Whether the stored user layer already carries an allowlist choice. An empty
 * array counts: it is the user saying "no restriction", which the default-model
 * seed below must not undo on the next open.
 */
function allowlistExpressed(user: unknown): boolean {
  return typeof user === 'object' && user !== null && !Array.isArray(user)
    && Object.hasOwn(user, 'allowedModels')
}

/**
 * The stored section as this panel's draft shape.
 *
 * Until the user layer carries its own allowlist, the allowlist starts as the
 * saved default model alone: a panel that opens on "any model" while a default
 * is configured says the opposite of what the deployment is set up to do.
 */
function draftOf(
  section: SubagentSettingsSection | undefined,
  user: unknown,
): Required<SubagentSettingsSection> {
  const concurrency = section?.maxConcurrent
  const stored = normaliseRoutes(section)
  const seed = allowlistExpressed(user) ? undefined : routeOf(section)
  return {
    provider: section?.provider ?? '',
    model: section?.model ?? '',
    reasoningEffort: section?.reasoningEffort ?? '',
    maxConcurrent: typeof concurrency === 'number' && Number.isFinite(concurrency)
      ? Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, Math.round(concurrency)))
      : DEFAULT_CONCURRENT,
    allowedModels: stored.length === 0 && seed !== undefined ? [seed] : stored,
    singleLevel: section?.singleLevel !== false,
  }
}

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
  heading: {
    margin: 0,
    fontSize: '13px',
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
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    background: 'var(--dsw-alias-bg-layer-0)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '10px',
  } as const,
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
  rangeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  range: {
    flex: '1 1 auto',
    accentColor: 'var(--dsw-alias-button-primary-fill)',
  } as const,
  valueBadge: {
    minWidth: '28px',
    padding: '2px 8px',
    textAlign: 'center',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '6px',
  } as const,
  tagCloud: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    maxHeight: '190px',
    overflowY: 'auto',
  } as const,
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 9px',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '999px',
  } as const,
  tagToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: 0,
    fontSize: '12px',
    color: 'inherit',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  } as const,
  tagRemove: {
    padding: '0 1px',
    fontSize: '13px',
    lineHeight: 1,
    color: 'inherit',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  } as const,
  tagSelected: {
    color: 'var(--dsw-alias-label-primary-foreground)',
    background: 'var(--dsw-alias-button-primary-fill)',
    borderColor: 'var(--dsw-alias-button-primary-fill)',
  } as const,
  tagProvider: {
    fontSize: '11px',
    opacity: 0.75,
  } as const,
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  } as const,
  toggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '14px',
    background: 'var(--dsw-alias-bg-layer-0)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '10px',
  } as const,
  toggleCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
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
  linkButton: {
    padding: '2px 4px',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
  } as const,
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

export function SubagentSettingsPanel(props: SubagentSettingsPanelProps) {
  const snapshot = props.useConfigurableSubagentSettings(value => value)
  const stored = useMemo(
    () => draftOf(snapshot.value, snapshot.user),
    [snapshot.value, snapshot.user],
  )
  const [draft, setDraft] = useState<Required<SubagentSettingsSection>>(() => draftOf(undefined, undefined))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogOutcome | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!dirty) setDraft(stored)
  }, [stored, dirty])

  // One read per mount (and per explicit retry): the injected face is not a
  // stable identity to depend on.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const answer = await props.loadModels()
        if (!cancelled) setCatalog(answer)
      } catch (error) {
        if (!cancelled) {
          setCatalog({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => { cancelled = true }
  }, [attempt])

  const chosen = draft.allowedModels
  const chosenKeys = useMemo(() => new Set(chosen.map(routeKey)), [chosen])

  /** Catalog entries by route, so an allowed route renders with display names. */
  const catalogByKey = useMemo(() => {
    const map = new Map<string, ModelChoice>()
    if (catalog?.status === 'ready') {
      for (const choice of catalog.choices) map.set(routeKey(choice), choice)
    }
    return map
  }, [catalog])

  /**
   * Search results, offered for selection. Empty while the search box is empty:
   * the list of everything a deployment *could* run is not a selection, and it
   * buries the allowed set underneath it.
   */
  const offers = useMemo(() => {
    if (catalog?.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    if (needle === '') return []
    return catalog.choices
      .filter(choice => !chosenKeys.has(routeKey(choice)))
      .filter(choice =>
        choice.model.toLowerCase().includes(needle)
        || choice.modelName.toLowerCase().includes(needle)
        || choice.provider.toLowerCase().includes(needle)
        || choice.providerName.toLowerCase().includes(needle))
  }, [catalog, query, chosenKeys])

  const visibleOffers = offers.slice(0, MAX_VISIBLE_TAGS)
  const totalChoices = catalog?.status === 'ready' ? catalog.choices.length : 0
  const searching = query.trim() !== ''

  const update = (
    field: keyof SubagentSettingsSection,
    value: string | number | boolean | ModelRoute[],
  ): void => {
    setDraft(current => ({ ...current, [field]: value }))
    setDirty(true)
    setOutcome(null)
  }

  const addRoute = (choice: ModelChoice): void => {
    if (chosenKeys.has(routeKey(choice))) return
    update('allowedModels', [...chosen, { provider: choice.provider, model: choice.model }])
  }

  const removeRoute = (route: ModelRoute): void => {
    const key = routeKey(route)
    update('allowedModels', chosen.filter(entry => routeKey(entry) !== key))
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
    <h2 style={styles.title}>Sub-agents</h2>
    <p style={styles.copy}>
      Defaults for delegated work. A delegation may override the route per call; the model allowlist and
      the concurrency limit are enforced by the host, and the model reads both in its tool guidance.
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
      Leave provider and model blank to inherit the parent route, or the first allowed model below. A call
      can set reasoning_effort to provider-default to bypass the saved effort.
    </p>

    <div style={styles.card}>
      <label htmlFor="configurable-subagent-concurrency" style={styles.heading}>
        Max concurrent sub-agents
      </label>
      <div style={styles.rangeRow}>
        <input
          id="configurable-subagent-concurrency"
          type="range"
          min={MIN_CONCURRENT}
          max={MAX_CONCURRENT}
          step={1}
          style={styles.range}
          value={draft.maxConcurrent}
          disabled={!ready || saving}
          onChange={event => update('maxConcurrent', Number(event.currentTarget.value))}
        />
        <span style={styles.valueBadge}>{draft.maxConcurrent}</span>
      </div>
      <p style={styles.copy}>
        At most this many sub-agents run at the same time ({MIN_CONCURRENT}–{MAX_CONCURRENT}, default{' '}
        {DEFAULT_CONCURRENT}). A delegation past the limit is refused with an explanation rather than queued.
      </p>
    </div>

    <div style={styles.card}>
      <h3 style={styles.heading}>Allowed sub-agent models</h3>
      <p style={styles.copy}>
        Search to find a model, then click its tag to allow it for sub-agents. Available models appear only
        while you search; allowed ones stay listed with an × to remove them. Until you pick a list it starts
        as the saved default model alone, and an empty list means any model may be used.
      </p>
      <input
        id="configurable-subagent-model-search"
        style={styles.input}
        value={query}
        placeholder="Search providers and models…"
        disabled={!ready || saving}
        onChange={event => setQuery(event.currentTarget.value)}
      />
      {catalog === null && <p style={styles.status}>Loading models…</p>}
      {catalog?.status === 'error' && <div style={styles.chipRow}>
        <p style={styles.error}>Could not read the model catalog: {catalog.message}</p>
        <button
          type="button"
          style={styles.linkButton}
          onClick={() => { setCatalog(null); setAttempt(current => current + 1) }}
        >
          Retry
        </button>
      </div>}
      {catalog?.status === 'ready' && totalChoices === 0 && (
        <p style={styles.status}>
          No provider advertises models right now, so the allowlist stays unrestricted.
        </p>
      )}

      {(chosen.length > 0 || visibleOffers.length > 0) && <div style={styles.tagCloud}>
        {chosen.map(route => {
          const choice = catalogByKey.get(routeKey(route))
          const label = choice?.description ?? `${choice?.providerName ?? route.provider} · ${route.model}`
          return <span key={routeKey(route)} style={{ ...styles.tag, ...styles.tagSelected }}>
            <span style={styles.tagToggle} title={label}>
              <span style={styles.tagProvider}>{choice?.providerName ?? route.provider}</span>
              <span>{choice?.modelName ?? route.model}</span>
            </span>
            <button
              type="button"
              title={`Remove ${label}`}
              aria-label={`Remove ${choice?.providerName ?? route.provider} ${choice?.modelName ?? route.model}`}
              style={styles.tagRemove}
              disabled={!ready || saving}
              onClick={() => removeRoute(route)}
            >
              ×
            </button>
          </span>
        })}
        {visibleOffers.map(choice => <button
          key={routeKey(choice)}
          type="button"
          title={`Allow ${choice.description ?? `${choice.providerName} · ${choice.model}`}`}
          aria-label={`Allow ${choice.providerName} ${choice.modelName}`}
          style={styles.tag}
          disabled={!ready || saving}
          onClick={() => addRoute(choice)}
        >
          <span style={styles.tagProvider}>{choice.providerName}</span>
          <span>{choice.modelName}</span>
        </button>)}
      </div>}

      {catalog?.status === 'ready' && totalChoices > 0 && (searching
        ? <p style={styles.status}>
          {offers.length === 0
            ? <>No model matches “{query.trim()}”.</>
            : <>
              {offers.length} match{offers.length === 1 ? '' : 'es'} for “{query.trim()}”; click one to allow it.
              {offers.length > visibleOffers.length
                ? ` Showing the first ${visibleOffers.length}; narrow the search for the rest.`
                : ''}
            </>}
        </p>
        : <div style={styles.chipRow}>
          <p style={styles.status}>
            {chosen.length === 0
              ? `No restriction — any model may be used as a sub-agent. Search to allow specific models (${totalChoices} available).`
              : `Allowed: ${chosen.length} of ${totalChoices} advertised models. Search to add more.`}
          </p>
          {chosen.length > 0 && <button
            type="button"
            style={styles.linkButton}
            disabled={!ready || saving}
            onClick={() => update('allowedModels', [])}
          >
            Clear all
          </button>}
        </div>)}

      {catalog?.status === 'ready' && catalog.failures.length > 0 && (
        <p style={styles.status}>Some providers reported no catalog: {catalog.failures.join('; ')}</p>
      )}
    </div>

    <div style={styles.toggleRow}>
      <input
        id="configurable-subagent-single-level"
        type="checkbox"
        checked={draft.singleLevel}
        disabled={!ready || saving}
        onChange={event => update('singleLevel', event.currentTarget.checked)}
      />
      <span style={styles.toggleCopy}>
        <label htmlFor="configurable-subagent-single-level" style={styles.label}>One level deep</label>
        <span style={styles.copy}>
          Sub-agents may not start their own sub-agents. Turn this off to allow nested delegation.
        </span>
      </span>
    </div>

    <div style={styles.actions}>
      <button
        type="button"
        style={{ ...styles.button, ...(disabled ? styles.disabled : {}) }}
        disabled={disabled}
        onClick={() => { void save() }}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
      {outcome?.status === 'saved' && <p style={styles.status}>Saved.</p>}
      {outcome?.status === 'not-applied' && <p style={styles.error}>The host did not apply all values.</p>}
      {outcome?.status === 'error' && <p style={styles.error}>{outcome.message}</p>}
    </div>
  </div>
}
