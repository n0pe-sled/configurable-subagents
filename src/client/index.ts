import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  SubagentSettingsPanel,
  normaliseRoutes,
  sameRoutes,
  type CatalogOutcome,
  type ModelChoice,
  type SubagentSettingsSection,
  type SaveOutcome,
} from './SettingsPanel.tsx'

export const inject = ['slots', 'settingsScope']

/**
 * Wire view of the host model catalog (`llm.models`), declared here because the
 * published host contracts resolve to `any` outside the harness repo, and a
 * checked local shape is what keeps this half's own logic typed.
 */
interface ModelCatalogApi {
  llm: {
    models(payload: Record<string, never>): Promise<{
      result:
        | {
          ok: true
          value: {
            groups: {
              id: string
              name: string
              models: { id: string; name: string; description?: string }[]
            }[]
            failures: { id: string; name: string; message: string }[]
          }
        }
        | { ok: false; error: { code: string; message: string } }
    }>
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Flatten the host's provider groups into the picker's one offer list. */
function choicesOf(
  groups: {
    id: string
    name: string
    models: { id: string; name: string; description?: string }[]
  }[],
): ModelChoice[] {
  const choices: ModelChoice[] = []
  for (const group of groups) {
    for (const model of Array.isArray(group?.models) ? group.models : []) {
      const id = typeof model.id === 'string' ? model.id.trim() : ''
      if (id === '') continue
      const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name : id
      choices.push({
        provider: group.id,
        providerName: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
        model: id,
        modelName: name,
        ...typeof model.description === 'string' && model.description !== ''
          ? { description: model.description }
          : {},
      })
    }
  }
  return choices
}

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<SubagentSettingsSection>({ namespace: 'configurable-subagents' })

  const save = async (values: Required<SubagentSettingsSection>): Promise<SaveOutcome> => {
    const allowedModels = normaliseRoutes(values)
    try {
      await scope.set('provider', values.provider)
      await scope.set('model', values.model)
      await scope.set('reasoningEffort', values.reasoningEffort)
      await scope.set('maxConcurrent', values.maxConcurrent)
      await scope.set('allowedModels', allowedModels)
      await scope.set('singleLevel', values.singleLevel)
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
    const stored = scope.getSnapshot().value
    return stored?.provider === values.provider
      && stored.model === values.model
      && stored.reasoningEffort === values.reasoningEffort
      && stored.maxConcurrent === values.maxConcurrent
      && stored.singleLevel === values.singleLevel
      && sameRoutes(normaliseRoutes(stored), allowedModels)
      ? { status: 'saved' }
      : { status: 'not-applied' }
  }

  // Resolved per call rather than injected: the panel must mount even in a
  // client whose connection is not up yet, where the catalog simply reads as
  // unavailable until it is.
  const loadModels = async (): Promise<CatalogOutcome> => {
    const connection = ctx.get('connection') as { api: ModelCatalogApi } | undefined
    if (connection === undefined) {
      return { status: 'error', message: 'this client has no host connection, so no models are listed' }
    }
    try {
      const response = await connection.api.llm.models({})
      if (!response.result.ok) {
        return {
          status: 'error',
          message: `${response.result.error.code}: ${response.result.error.message}`,
        }
      }
      const { groups, failures } = response.result.value
      return {
        status: 'ready',
        choices: choicesOf(Array.isArray(groups) ? groups : []),
        failures: (Array.isArray(failures) ? failures : [])
          .map(failure => `${failure.name ?? failure.id}: ${failure.message}`),
      }
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'configurable-subagents',
    order: 210,
    label: 'Sub-agents',
    inject: () => ({
      hooks: { configurableSubagentSettings: scope },
      save,
      loadModels,
    }),
  }, SubagentSettingsPanel))
}

export type {
  CatalogOutcome,
  ModelChoice,
  ModelRoute,
  SaveOutcome,
  SubagentSettingsSection,
} from './SettingsPanel.tsx'
