import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ObjectJsonSchema, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'configurable-subagents'
export const inject = ['settings', 'tools']

const NAMESPACE = 'configurable-subagents' as SettingsNamespace
const TOOL_NAMES = ['subagent', 'subagent_fork'] as const
const PROVIDER_DEFAULT = 'provider-default'

/**
 * Registered prompt-section name. The `tool:` prefix is the harness convention
 * for per-tool guidance, and it is also what places this section in the
 * tool-guidance band (orders 100–199) rather than beside the persona.
 */
const ROUTING_SECTION = 'tool:subagent-routing'
/** Placed just after the shipped `tool:subagent` guidance (order 116.5). */
const ROUTING_SECTION_ORDER = 117

/** Concurrency bounds the settings slider may express. */
export const MIN_CONCURRENT = 1
export const MAX_CONCURRENT = 8
export const DEFAULT_CONCURRENT = 4

/** One model route a sub-agent may run on, as the allowlist stores it. */
export interface ModelRoute {
  provider: string
  model: string
}

export interface SettingsSection {
  provider: string
  model: string
  reasoningEffort: string
  /** Maximum number of sub-agents allowed to run at the same time. */
  maxConcurrent: number
  /** Routes sub-agents may use; empty means "any route". */
  allowedModels: ModelRoute[]
  /** Whether sub-agents are barred from delegating further themselves. */
  singleLevel: boolean
}

interface RoutingSelection {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

interface RoutingArguments {
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
}

const settingsSchema: z<SettingsSection> = Schema.object({
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  reasoningEffort: Schema.string().default(''),
  maxConcurrent: Schema.number().min(MIN_CONCURRENT).max(MAX_CONCURRENT).default(DEFAULT_CONCURRENT),
  allowedModels: Schema.array(Schema.object({
    provider: Schema.string().required(),
    model: Schema.string().required(),
  })).default([]),
  singleLevel: Schema.boolean().default(true),
})

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The stored allowlist, normalized: trimmed, non-empty, de-duplicated, in
 * stored order. An entry missing either half is dropped rather than left to
 * reject every delegation it would gate.
 */
export function allowedRoutesOf(section: SettingsSection | undefined): ModelRoute[] {
  const stored = Array.isArray(section?.allowedModels) ? section.allowedModels : []
  const routes: ModelRoute[] = []
  for (const entry of stored) {
    const provider = nonEmpty(entry?.provider)
    const model = nonEmpty(entry?.model)
    if (provider === undefined || model === undefined) continue
    if (routes.some(route => route.provider === provider && route.model === model)) continue
    routes.push({ provider, model })
  }
  return routes
}

/**
 * The effective concurrency cap. A value the schema could not have produced (a
 * direct `apply()` with no stored section) falls back to the default rather
 * than becoming `NaN`, which would refuse every delegation.
 */
export function concurrencyOf(section: SettingsSection | undefined): number {
  const stored = section?.maxConcurrent
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return DEFAULT_CONCURRENT
  return Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, Math.round(stored)))
}

/** Whether sub-agents are barred from delegating further. Defaults on. */
export function singleLevelOf(section: SettingsSection | undefined): boolean {
  return section?.singleLevel !== false
}

function routingArguments(value: unknown): RoutingArguments {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const provider = nonEmpty(record.provider)
  const model = nonEmpty(record.model)
  const reasoningEffort = nonEmpty(record.reasoning_effort)
  return {
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort },
  }
}

function baseArguments(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const {
    provider: _provider,
    model: _model,
    reasoning_effort: _reasoningEffort,
    ...base
  } = value as Record<string, unknown>
  return base
}

/** Render one route the way messages and prompt text refer to it. */
function routeLabel(route: ModelRoute): string {
  return `${route.provider}/${route.model}`
}

/**
 * The route a delegation with no explicit selection runs on.
 *
 * With an allowlist configured the allowlist always wins: a configured default
 * that is not on it is passed over in favor of that list's first entry, so no
 * child can run on a route the user did not permit.
 */
function defaultsOf(section: SettingsSection | undefined, allowed: readonly ModelRoute[]): RoutingSelection {
  const provider = nonEmpty(section?.provider)
  const model = nonEmpty(section?.model)
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('configurable subagent defaults require provider and model together')
  }
  const effort = nonEmpty(section?.reasoningEffort)
  const configured = provider === undefined || model === undefined ? undefined : { provider, model }
  const fallback = allowed[0]
  const route = configured !== undefined
    && (allowed.length === 0 || allowed.some(entry => entry.provider === provider && entry.model === model))
    ? configured
    : fallback
  return {
    ...route === undefined ? {} : { provider: route.provider, model: route.model },
    ...effort === undefined ? {} : { reasoningEffort: effort },
  }
}

function selectionOf(args: unknown, section: SettingsSection | undefined): RoutingSelection {
  const requested = routingArguments(args)
  if ((requested.provider === undefined) !== (requested.model === undefined)) {
    throw new Error('subagent provider and model must be supplied together')
  }
  const allowed = allowedRoutesOf(section)
  const defaults = defaultsOf(section, allowed)
  if (
    requested.provider !== undefined
    && requested.model !== undefined
    && allowed.length > 0
    && !allowed.some(entry => entry.provider === requested.provider && entry.model === requested.model)
  ) {
    throw new Error(
      `model "${requested.provider}/${requested.model}" is not an allowed sub-agent model; `
      + `allowed models: ${allowed.map(routeLabel).join(', ')}`,
    )
  }
  const route = requested.provider === undefined
    ? defaults
    : { provider: requested.provider, model: requested.model }
  const requestedEffort = requested.reasoning_effort
  const reasoningEffort = requestedEffort === PROVIDER_DEFAULT
    ? undefined
    : requestedEffort ?? defaults.reasoningEffort
  return {
    ...route.provider === undefined ? {} : { provider: route.provider },
    ...route.model === undefined ? {} : { model: route.model },
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

function hasRouting(selection: RoutingSelection): boolean {
  return selection.provider !== undefined
    || selection.model !== undefined
    || selection.reasoningEffort !== undefined
}

/**
 * Live-sub-agent ledger: what the concurrency cap is enforced against.
 *
 * `live` holds every accepted run, keyed by the run id both lifecycle edges
 * carry, and is fed by the harness's own `subagent/start` / `subagent/end`
 * pair — the only signal that stays truthful for a background child, whose tool
 * call has already returned while the child keeps working.
 *
 * `pending` holds calls that passed the gate but whose run is not published
 * yet, so two delegations dispatched in one step cannot both read an unchanged
 * count and overshoot the cap. A reservation is retired by the next start edge
 * it matches, or by its own call ending, whichever comes first — which is what
 * keeps one foreground child from being counted twice.
 */
export interface ConcurrencyLedger {
  readonly live: Set<string>
  readonly pending: Set<{ matched: boolean }>
}

/** Delegations counted right now: accepted runs plus calls still starting. */
export function activeDelegations(ledger: ConcurrencyLedger): number {
  return ledger.live.size + ledger.pending.size
}

/**
 * Claim one delegation slot, or refuse when the cap is already reached.
 * @param ledger - the live-subagent ledger.
 * @param cap - the configured maximum.
 * @returns the reservation to release when this call ends.
 * @throws when as many delegations as the cap allows are already running.
 */
export function acquireSlot(ledger: ConcurrencyLedger, cap: number): { matched: boolean } {
  const active = activeDelegations(ledger)
  if (active >= cap) {
    throw new Error(
      `sub-agent concurrency limit reached: ${String(active)} of ${String(cap)} sub-agents are still running. `
      + 'Wait for a completion notice (or collect a background child with job_output) before delegating again, '
      + 'or raise the limit in Settings → Sub-agents.',
    )
  }
  const reservation = { matched: false }
  ledger.pending.add(reservation)
  return reservation
}

/** Retire a reservation its own call no longer needs. */
export function releaseSlot(ledger: ConcurrencyLedger, reservation: { matched: boolean }): void {
  ledger.pending.delete(reservation)
}

/** Record one published run, retiring the reservation it belongs to. */
export function noteRunStart(ledger: ConcurrencyLedger, runId: string): void {
  const reservation = ledger.pending.values().next()
  if (!reservation.done) {
    reservation.value.matched = true
    ledger.pending.delete(reservation.value)
  }
  ledger.live.add(runId)
}

/** Record one settled run. */
export function noteRunEnd(ledger: ConcurrencyLedger, runId: string): void {
  ledger.live.delete(runId)
}

/**
 * Whether this caller may delegate at all: a deployment restricted to one level
 * of delegation must not let a sub-agent start children of its own.
 */
function assertDelegationDepth(agent: Agent | undefined, section: SettingsSection | undefined): void {
  if (!singleLevelOf(section)) return
  if (agent?.session.header.origin !== 'subagent') return
  throw new Error(
    'sub-agents may not delegate further: this deployment allows one level of delegation. '
    + 'Turn off "One level deep" in Settings → Sub-agents to allow nested sub-agents.',
  )
}

function extendParameters(parameters: ObjectJsonSchema): ObjectJsonSchema {
  return {
    ...parameters,
    additionalProperties: false,
    properties: {
      ...parameters.properties,
      provider: {
        type: 'string',
        description: 'Optional LLM provider route for this child. Supply provider and model together.',
      },
      model: {
        type: 'string',
        description: 'Optional model id for this child. Supply provider and model together.',
      },
      reasoning_effort: {
        type: 'string',
        description:
          `Optional adapter-owned reasoning effort for this child, such as low, high, or max. Use "${PROVIDER_DEFAULT}" to ignore the configured subagent default.`,
      },
    },
  }
}

function createWrapper(
  original: ToolDefinition,
  settings: () => SettingsSection | undefined,
  routing: AsyncLocalStorage<RoutingSelection>,
  ledger: ConcurrencyLedger,
): ToolDefinition {
  const toBase = (args: unknown): unknown => baseArguments(args)
  return {
    ...original,
    description: `${original.description} Optional provider, model, and reasoning_effort fields select the child's LLM route for this delegation.`,
    parameters: extendParameters(original.parameters as unknown as ObjectJsonSchema) as unknown as Record<string, unknown>,
    ...original.isConcurrencySafe === undefined
      ? {}
      : { isConcurrencySafe: (args: unknown) => original.isConcurrencySafe?.(toBase(args)) === true },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const section = settings()
      assertDelegationDepth(exec.agent, section)
      const selected = selectionOf(args, section)
      const reservation = acquireSlot(ledger, concurrencyOf(section))
      try {
        return await routing.run(selected, () => original.execute(toBase(args), exec))
      } finally {
        releaseSlot(ledger, reservation)
      }
    },
  }
}

/**
 * The tool-guidance paragraph the model reads whenever a sub-agent tool is
 * visible in its scope: how to pick a child's model, how to ask for thinking
 * effort, and the limits this deployment enforces.
 *
 * Returns the empty string for a hidden tool, matching how the shipped tool
 * sections behave — guidance for an absent tool is only noise.
 */
export function routingGuidance(section: SettingsSection | undefined): string {
  const allowed = allowedRoutesOf(section)
  const defaults = defaultsOf(section, allowed)
  const cap = concurrencyOf(section)
  const effort = defaults.reasoningEffort
  const sentences = [
    'Choosing a sub-agent\'s model: `subagent` and `subagent_fork` accept optional `provider` and `model` '
    + 'fields (supply both together) and `reasoning_effort` for the child\'s thinking effort — an adapter '
    + `value such as \`low\`, \`high\`, or \`max\`, or \`${PROVIDER_DEFAULT}\` to use the adapter default.`,
    defaults.provider === undefined || defaults.model === undefined
      ? 'With neither field set, the child inherits the parent\'s route.'
      : `With neither field set, the child runs on \`${routeLabel({ provider: defaults.provider, model: defaults.model })}\``
        + `${effort === undefined ? '' : ` with reasoning effort \`${effort}\``}.`,
  ]
  if (allowed.length > 0) {
    sentences.push(`Only these models may be used as sub-agents: ${allowed.map(routeLabel).join(', ')}.`)
  }
  sentences.push(`At most ${String(cap)} sub-agents run at once; a further delegation is refused until one settles.`)
  if (singleLevelOf(section)) {
    sentences.push('Delegation is one level deep: a sub-agent must not start its own children.')
  }
  return sentences.join(' ')
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(NAMESPACE, settingsSchema)
  const routing = new AsyncLocalStorage<RoutingSelection>()
  const childRouting = new WeakMap<Agent, RoutingSelection>()
  const wrappers = new WeakSet<ToolDefinition>()
  const ledger: ConcurrencyLedger = { live: new Set(), pending: new Set() }

  // Both lifecycle edges are dispatched with the delegating parent as their
  // scope carrier, so a listener on this root context observes every delegation
  // in the deployment, whatever started it (tool, workflow, or continuation).
  ctx.on('subagent/start', ({ runId }) => { noteRunStart(ledger, runId) })
  ctx.on('subagent/end', ({ runId }) => { noteRunEnd(ledger, runId) })

  ctx.on('agent/created', ({ agent }) => {
    for (const toolName of TOOL_NAMES) {
      let installed = false
      let installing = false
      const install = (): void => {
        if (installed || installing) return
        const original = ctx.tools.get(toolName, agent)
        if (original === undefined || wrappers.has(original)) return
        installing = true
        try {
          const wrapper = createWrapper(original, () => settings.get(), routing, ledger)
          wrappers.add(wrapper)
          agent.ctx.tools.register(wrapper)
          installed = true
        } finally {
          installing = false
        }
      }

      install()
      if (!installed) agent.ctx.on('tools/change', install)
    }
  })

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (agent.session.header.origin !== 'subagent' || source === 'resume') return
    const section = settings.get()
    const selected = routing.getStore() ?? defaultsOf(section, allowedRoutesOf(section))
    if (hasRouting(selected)) childRouting.set(agent, selected)
  })

  ctx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
    const config = await next()
    const selected = childRouting.get(agent)
    if (selected === undefined) return config
    return {
      ...config,
      ...selected.provider === undefined ? {} : { provider: selected.provider },
      ...selected.model === undefined ? {} : { model: selected.model },
      ...selected.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selected.reasoningEffort as ReasoningEffortId },
    }
  })

  // Scoped injection, so a deployment with no system prompt (a headless caller)
  // still gets per-call routing and the runtime caps.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: ROUTING_SECTION,
      order: ROUTING_SECTION_ORDER,
      // Evaluated per assembly against live settings, so a saved change reaches
      // the next step without re-registering anything.
      text: context => TOOL_NAMES.some(name => promptCtx.tools.get(name, context.scope) !== undefined)
        ? routingGuidance(settings.get())
        : '',
    })
  })
}
