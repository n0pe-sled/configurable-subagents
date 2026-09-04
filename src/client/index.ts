import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  SubagentSettingsPanel,
  type SaveOutcome,
  type SubagentSettingsSection,
} from './SettingsPanel.tsx'

export const inject = ['slots', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<SubagentSettingsSection>({ namespace: 'configurable-subagents' })

  const save = async (values: Required<SubagentSettingsSection>): Promise<SaveOutcome> => {
    try {
      await scope.set('provider', values.provider)
      await scope.set('model', values.model)
      await scope.set('reasoningEffort', values.reasoningEffort)
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
    const stored = scope.getSnapshot().value
    return stored?.provider === values.provider
      && stored.model === values.model
      && stored.reasoningEffort === values.reasoningEffort
      ? { status: 'saved' }
      : { status: 'not-applied' }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'configurable-subagents',
    order: 210,
    label: 'Sub-agents',
    inject: () => ({
      hooks: { configurableSubagentSettings: scope },
      save,
    }),
  }, SubagentSettingsPanel))
}

export type {
  SaveOutcome,
  SubagentSettingsSection,
} from './SettingsPanel.tsx'
