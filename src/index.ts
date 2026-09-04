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

export interface SettingsSection {
  provider: string
  model: string
  reasoningEffort: string
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
})

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
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

function defaultsOf(section: SettingsSection | undefined): RoutingSelection {
  const provider = nonEmpty(section?.provider)
  const model = nonEmpty(section?.model)
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('configurable subagent defaults require provider and model together')
  }
  const effort = nonEmpty(section?.reasoningEffort)
  return {
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...effort === undefined ? {} : { reasoningEffort: effort },
  }
}

function selectionOf(args: unknown, section: SettingsSection | undefined): RoutingSelection {
  const requested = routingArguments(args)
  if ((requested.provider === undefined) !== (requested.model === undefined)) {
    throw new Error('subagent provider and model must be supplied together')
  }
  const defaults = defaultsOf(section)
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
      const selected = selectionOf(args, settings())
      return routing.run(selected, () => original.execute(toBase(args), exec))
    },
  }
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(NAMESPACE, settingsSchema)
  const routing = new AsyncLocalStorage<RoutingSelection>()
  const childRouting = new WeakMap<Agent, RoutingSelection>()
  const wrappers = new WeakSet<ToolDefinition>()

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
          const wrapper = createWrapper(original, () => settings.get(), routing)
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
    const selected = routing.getStore() ?? defaultsOf(settings.get())
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
}
